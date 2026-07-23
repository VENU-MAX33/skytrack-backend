import { Router } from 'express';
import { Types } from 'mongoose';
import { Trip } from '../models/Trip.js';
import { Employee } from '../models/Employee.js';
import { EscortReport } from '../models/EscortReport.js';
import { User } from '../models/User.js';
import { toEscortReportDTO, toTripDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { createEscortReport, acknowledgeEscortReport } from '../services/escort-report.service.js';
import { createNotification } from '../services/notification.service.js';
import { emitEscortReport, emitEscortReportAck, emitTripStatus } from '../websocket/index.js';

export const escortReportRouter = Router();

const REPORT_POPULATE = 'employeeId driverId tripId';
const TRIP_POPULATE = 'vehicleId driverId routeId employeeIds';
type PopulatedReport = Parameters<typeof toEscortReportDTO>[0];
type PopulatedTrip = Parameters<typeof toTripDTO>[0];

// POST /api/escort-report — employee reports whether an escort is present
escortReportRouter.post(
  '/',
  requireRole('employee'),
  idempotent(),
  asyncHandler(async (req, res) => {
    const { tripId, present, escortName } = req.body as {
      tripId?: string; present?: string; escortName?: string;
    };
    if (present !== 'Yes' && present !== 'No') {
      throw new HttpError(400, "present must be 'Yes' or 'No'");
    }

    let tripDoc = null;
    let driverObjectId: Types.ObjectId | undefined;
    let tripObjectId: Types.ObjectId | undefined;
    if (tripId) {
      tripDoc = await Trip.findOne({ tripId, employeeIds: req.auth!.sub });
      if (!tripDoc) throw new HttpError(404, 'Trip not found or you are not on this trip');
      tripObjectId = tripDoc._id;
      driverObjectId = tripDoc.driverId ?? undefined;
    }

    const employee = await Employee.findById(req.auth!.sub);

    const report = await createEscortReport({
      employeeId: new Types.ObjectId(req.auth!.sub),
      tripId: tripObjectId,
      driverId: driverObjectId,
      present,
      escortName,
      employeeName: employee?.name,
      employeeContact: employee?.contact,
    });
    await report.populate(REPORT_POPULATE);
    const dto = toEscortReportDTO(report as unknown as PopulatedReport);

    emitEscortReport({ report: dto, driverId: driverObjectId?.toString() });

    // Update the trip so driver + employee apps reflect the reported escort.
    if (tripDoc) {
      tripDoc.escort = present;
      tripDoc.escortName = present === 'Yes' ? (escortName ?? '').trim() : '';
      await tripDoc.save();
      await tripDoc.populate(TRIP_POPULATE);
      const populated = tripDoc as unknown as PopulatedTrip;
      emitTripStatus({
        trip: toTripDTO(populated),
        driverId: populated.driverId?._id.toString() ?? '',
        employeeIds: populated.employeeIds.map((e) => e._id.toString()),
      });
    }

    await createNotification({
      type: 'escort',
      title: `Escort update from ${dto.employee.name || 'Employee'}`,
      body: dto.present === 'Yes'
        ? `Escort present${dto.escortName ? `: ${dto.escortName}` : ''}`
        : 'No escort present',
      refId: dto.id,
      link: '/',
    });

    res.status(201).json(dto);
  })
);

// GET /api/escort-report — admin lists reports (newest first)
escortReportRouter.get(
  '/',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { status } = req.query as { status?: string };
    const query = status ? { status } : {};
    const docs = await EscortReport.find(query).sort({ createdAt: -1 }).limit(100).populate(REPORT_POPULATE);
    res.json(docs.map((d) => toEscortReportDTO(d as unknown as PopulatedReport)));
  })
);

// PUT /api/escort-report/:id/acknowledge — admin acknowledges
escortReportRouter.put(
  '/:id/acknowledge',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const admin = await User.findById(req.auth!.sub);
    const updated = await acknowledgeEscortReport(req.params.id, admin?.name ?? 'Admin');
    if (!updated) throw new HttpError(404, 'Escort report not found');
    await updated.populate(REPORT_POPULATE);
    const dto = toEscortReportDTO(updated as unknown as PopulatedReport);
    emitEscortReportAck({ report: dto, driverId: updated.driverId?.toString() });
    res.json(dto);
  })
);

// DELETE /api/escort-report/:id — admin removes a report
escortReportRouter.delete(
  '/:id',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const doc = await EscortReport.findByIdAndDelete(req.params.id);
    if (!doc) throw new HttpError(404, 'Escort report not found');
    res.status(204).end();
  })
);
