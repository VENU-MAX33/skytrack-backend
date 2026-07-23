import { Router } from 'express';
import { Types } from 'mongoose';
import { Trip } from '../models/Trip.js';
import { Employee } from '../models/Employee.js';
import { Route } from '../models/Route.js';
import { Vehicle } from '../models/Vehicle.js';
import { SOSAlert } from '../models/SOSAlert.js';
import { SosConfig } from '../models/SosConfig.js';
import { User } from '../models/User.js';
import { toSosDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';
import { requireCompanyContext } from '../middleware/auth.js';
import { normalizePhone } from '../services/phone-login.service.js';
import { idempotent } from '../middleware/idempotency.js';
import { createSos, acknowledgeSos } from '../services/sos.service.js';
import { createNotification } from '../services/notification.service.js';
import { emitSos, emitSosAck } from '../websocket/index.js';

export const sosRouter = Router();

const SOS_POPULATE = 'employeeId driverId tripId';
type PopulatedSos = Parameters<typeof toSosDTO>[0];

// POST /api/sos — employee triggers an emergency alert
sosRouter.post(
  '/',
  requireRole('employee'),
  idempotent(),
  asyncHandler(async (req, res) => {
    const { tripId, location, reason, photoBase64 } = req.body as {
      tripId?: string;
      location?: string;
      reason?: string;
      photoBase64?: string;
    };

    let driverObjectId: Types.ObjectId | undefined;
    let tripObjectId: Types.ObjectId | undefined;
    let routeName: string | undefined;
    let vehicleNo: string | undefined;
    if (tripId) {
      const trip = await Trip.findOne({ tripId, employeeIds: req.auth!.sub });
      if (!trip) throw new HttpError(404, 'Trip not found or you are not on this trip');
      tripObjectId = trip._id;
      driverObjectId = trip.driverId ?? undefined;
      const [route, vehicle] = await Promise.all([
        Route.findById(trip.routeId).select('name').lean(),
        Vehicle.findById(trip.vehicleId).select('rtoNo').lean(),
      ]);
      routeName = route?.name;
      vehicleNo = vehicle?.rtoNo;
    }

    // Fetch employee name/contact for the SMS notification
    const employee = await Employee.findById(req.auth!.sub);

    const alert = await createSos({
      employeeId: new Types.ObjectId(req.auth!.sub),
      tripId: tripObjectId,
      driverId: driverObjectId,
      location,
      reason,
      photoBase64,
      employeeName: employee?.name,
      employeeContact: employee?.contact,
      tripReference: tripObjectId ? tripId : undefined,
      routeName,
      vehicleNo,
    });
    await alert.populate(SOS_POPULATE);
    const dto = toSosDTO(alert as unknown as PopulatedSos);

    emitSos({ alert: dto, driverId: driverObjectId?.toString() });
    await createNotification({
      type: 'sos',
      title: `SOS from ${dto.employee.name || 'Employee'}`,
      body: dto.reason || dto.location || 'Emergency alert raised',
      refId: dto.id,
      link: '/',
    });
    res.status(201).json(dto);
  })
);

// GET /api/sos — admin lists alerts (open first)
sosRouter.get(
  '/',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { status } = req.query as { status?: string };
    const query = status ? { status } : {};
    const docs = await SOSAlert.find(query).sort({ createdAt: -1 }).limit(100).populate(SOS_POPULATE);
    res.json(docs.map((d) => toSosDTO(d as unknown as PopulatedSos)));
  })
);

// PUT /api/sos/:id/acknowledge — admin acknowledges an alert
sosRouter.put(
  '/:id/acknowledge',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const admin = await User.findById(req.auth!.sub);
    const updated = await acknowledgeSos(req.params.id, admin?.name ?? 'Admin');
    if (!updated) throw new HttpError(404, 'SOS alert not found');

    await updated.populate(SOS_POPULATE);
    const dto = toSosDTO(updated as unknown as PopulatedSos);
    emitSosAck({ alert: dto, driverId: updated.driverId?.toString() });
    res.json(dto);
  })
);

// DELETE /api/sos/:id — MAIN admin only (staff cannot delete alert history)
sosRouter.delete(
  '/:id',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const doc = await SOSAlert.findByIdAndDelete(req.params.id);
    if (!doc) throw new HttpError(404, 'SOS alert not found');
    res.status(204).end();
  })
);

// GET /api/sos/config — admin gets alert phone config
sosRouter.get(
  '/config',
  requireRole('platform-owner', 'admin'),
  requireCompanyContext,
  asyncHandler(async (_req, res) => {
    const config = await SosConfig.findOne();
    res.json({ alertPhone: config?.alertPhone ?? '' });
  })
);

// PUT /api/sos/config — admin saves alert phone number
sosRouter.put(
  '/config',
  requireRole('platform-owner', 'admin'),
  requireCompanyContext,
  asyncHandler(async (req, res) => {
    const { alertPhone } = req.body as { alertPhone?: string };
    const value = (alertPhone ?? '').trim();
    const normalized = value ? normalizePhone(value) : '';
    const config = await SosConfig.findOneAndUpdate(
      {},
      { alertPhone: normalized },
      { upsert: true, new: true }
    );
    res.json({ alertPhone: config.alertPhone });
  })
);
