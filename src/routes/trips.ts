import { Router } from 'express';
import type { FilterQuery } from 'mongoose';
import { Trip, type TripDoc } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { Driver } from '../models/Driver.js';
import { Route } from '../models/Route.js';
import { Employee } from '../models/Employee.js';
import { Counter } from '../models/Counter.js';
import { currentCompanyId } from '../tenancy/context.js';
import { toDriverTripDTO, toEmployeeTripDTO, toTripDTO } from '../mappers.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { STATUS_BUCKETS, localToday } from '../lib/statusBuckets.js';
import { emitTripFrozen, emitTripScheduleUpdate, emitTripStatus, emitTripUnassigned } from '../websocket/index.js';
import { idempotent } from '../middleware/idempotency.js';
import { dltTextVariable, sendCompanySms } from '../services/sms.service.js';
import { env } from '../config/env.js';
import { sendDriverTripPush } from '../services/driver-notification.service.js';

export const tripsRouter = Router();

const TRIP_POPULATE = 'vehicleId driverId routeId employeeIds';
type Populated = Parameters<typeof toTripDTO>[0];

function broadcastSchedule(populated: Populated): void {
  emitTripScheduleUpdate({
    tripId: populated.tripId,
    driverId: populated.driverId?._id.toString() ?? '',
    employeeIds: populated.employeeIds.map((employee) => employee._id.toString()),
  });
}

function reachTimeOnTripDate(tripDate: string, value: unknown): Date {
  const time = String(value ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new HttpError(400, 'reachTime must use HH:mm (24-hour time)');
  }
  const date = new Date(`${tripDate}T${time}:00+05:30`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Trip date or reach time is invalid');
  return date;
}

// Hands out the next per-day trip id atomically. The counter is seeded once (via
// $max) from any pre-existing trips for the day — e.g. seeded data created
// before the counter existed — so it never collides with them; after that a
// single $inc guarantees distinct ids even under concurrent requests.
export async function nextTripId(date: string): Promise<string> {
  const prefix = `TRP-${date.replace(/-/g, '').slice(2)}-`;
  const counterKey = `${currentCompanyId() ?? 'legacy'}:${prefix}`;
  const existing = await Counter.findById(counterKey).lean();
  if (!existing) {
    const last = await Trip.findOne({ tripId: new RegExp(`^${prefix}`) }).sort({ tripId: -1 });
    const lastSeq = last ? parseInt(last.tripId.slice(prefix.length), 10) : 0;
    await Counter.updateOne({ _id: counterKey }, { $max: { seq: lastSeq } }, { upsert: true });
  }
  const counter = await Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}${String(counter!.seq).padStart(3, '0')}`;
}

tripsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { fromDate, toDate, shiftTime, tripType, vendor, search, status, includeOngoing } = req.query as Record<
      string,
      string | undefined
    >;

    const query: FilterQuery<TripDoc> = {};
    if (fromDate || toDate) {
      const dateRange: Record<string, string> = {};
      if (fromDate) dateRange.$gte = fromDate;
      if (toDate) dateRange.$lte = toDate;
      if (includeOngoing === 'true') {
        query.$and = [{
          $or: [
            { date: dateRange },
            { status: { $in: STATUS_BUCKETS['in-progress'] }, completedAt: null },
          ],
        }];
      } else {
        query.date = dateRange;
      }
    }
    if (shiftTime) query.shiftTime = shiftTime;
    if (tripType) {
      // accept 'pick'/'drop' (deep links) as well as exact 'PickUp'/'Drop'
      const t = tripType.toLowerCase();
      query.type = t.startsWith('pick') ? 'PickUp' : t.startsWith('drop') ? 'Drop' : tripType;
    }
    if (vendor) query.vendor = vendor;
    if (status) {
      const bucket = STATUS_BUCKETS[status];
      query.status = bucket ? { $in: bucket } : status;
    }
    if (search) {
      // Search in the DB (was an in-memory scan over the whole collection).
      // vehicleNo lives on the populated Vehicle, so resolve matching ids first.
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const vehicleIds = (await Vehicle.find({ rtoNo: rx }).select('_id')).map((v) => v._id);
      query.$or = [
        { tripId: rx },
        { vendor: rx },
        { location: rx },
        { status: rx },
        ...(vehicleIds.length ? [{ vehicleId: { $in: vehicleIds } }] : []),
      ];
    }

    // Cap the result set so an unfiltered view of a large, ever-growing trips
    // collection can't load unbounded data; the newest trips are returned first.
    const docs = await Trip.find(query)
      .sort({ date: -1, shiftTime: 1 })
      .limit(2000)
      .populate(TRIP_POPULATE);
    res.json(docs.map((d) => toTripDTO(d as unknown as Populated)));
  })
);

tripsRouter.post(
  '/',
  idempotent(),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      type?: string;
      date?: string;
      shiftTime?: string;
      escort?: string;
      vehicleNo?: string;
      routeName?: string;
      employeeIds?: string[];
      scheduleStops?: { employeeId: string; reachTime: string }[];
      status?: string;
    };
    if (!body.type || !body.vehicleNo) throw new HttpError(400, 'type and vehicleNo are required');

    const vehicle = await Vehicle.findOne({ rtoNo: body.vehicleNo });
    if (!vehicle) throw new HttpError(422, `Vehicle ${body.vehicleNo} does not exist`);
    if (!vehicle.driverId) throw new HttpError(422, `Vehicle ${body.vehicleNo} has no assigned driver`);

    const route = body.routeName
      ? await Route.findOne({ name: body.routeName })
      : await Route.findOne();
    if (!route) throw new HttpError(422, `Route ${body.routeName ?? ''} does not exist`);

    const employees = body.employeeIds?.length
      ? await Employee.find({ empId: { $in: body.employeeIds } })
      : await Employee.find({ route: route.name, active: 'Yes' }).limit(4);
    if (body.employeeIds?.length && employees.length !== body.employeeIds.length) {
      throw new HttpError(422, 'One or more employee ids do not exist');
    }
    if (employees.length === 0) throw new HttpError(422, 'Trip needs at least one employee');

    const date = body.date ?? localToday();
    const tripId = await nextTripId(date);
    let scheduleStops: {
      employeeId: typeof employees[number]['_id'];
      sequence: number;
      plannedAt: Date;
      distanceMeters: number;
      durationSeconds: number;
    }[] = [];
    if (body.scheduleStops?.length) {
      const employeeById = new Map(employees.map((employee) => [employee.empId, employee]));
      const submitted = new Set<string>();
      scheduleStops = body.scheduleStops.map((stop, index) => {
        const employee = employeeById.get(String(stop.employeeId ?? '').trim());
        if (!employee) throw new HttpError(400, `Employee ${stop.employeeId} is not assigned to this trip`);
        if (submitted.has(employee.empId)) throw new HttpError(400, `Duplicate employee ${employee.empId}`);
        submitted.add(employee.empId);
        return {
          employeeId: employee._id,
          sequence: index + 1,
          plannedAt: reachTimeOnTripDate(date, stop.reachTime),
          distanceMeters: 0,
          durationSeconds: 0,
        };
      });
      if (submitted.size !== employees.length) {
        throw new HttpError(400, 'Enter a driver reach time for every employee');
      }
    }

    const doc = await Trip.create({
      tripId,
      status: body.status ?? 'Not Started Yet',
      type: body.type === 'Drop' ? 'Drop' : 'PickUp',
      date,
      escort: body.escort ?? 'No',
      shiftTime: body.shiftTime ?? '',
      vehicleId: vehicle._id,
      driverId: vehicle.driverId,
      routeId: route._id,
      employeeIds: employees.map((e) => e._id),
      vendor: vehicle.vendor,
      location: route.name,
      scheduleStops,
      ...(scheduleStops.length ? {
        scheduleMode: 'manual',
        scheduleCalculatedAt: new Date(),
        etaUpdatedAt: new Date(),
      } : {}),
    });
    const created = await Trip.findOne({ tripId }).populate(TRIP_POPULATE);
    res.status(201).json(toTripDTO(created as unknown as Populated));
  })
);

// The main admin can delete any trip, locked or not. Staff can only delete
// unlocked trips — deleting a locked/frozen trip is admin-only.
tripsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await Trip.findOne({ tripId: req.params.id });
    if (!doc) throw new HttpError(404, 'Trip not found');
    if (doc.frozen && !['admin', 'platform-owner'].includes(req.auth?.role ?? '')) {
      throw new HttpError(403, 'Only the main admin can delete a locked trip');
    }
    await doc.deleteOne();
    res.status(204).end();
  })
);

// PUT /api/trips/:id/vehicle — change the trip's vehicle at ANY status (admin + staff).
// The trip record is the source for all reports/exports, so the change persists there.
tripsRouter.put(
  '/:id/vehicle',
  asyncHandler(async (req, res) => {
    const { vehicleNo, reason = 'vehicle-reassignment' } = req.body as { vehicleNo?: string; reason?: string };
    if (!vehicleNo?.trim()) throw new HttpError(400, 'vehicleNo is required');

    const vehicle = await Vehicle.findOne({ rtoNo: vehicleNo.trim() });
    if (!vehicle) throw new HttpError(422, `Vehicle ${vehicleNo} does not exist`);

    const doc = await Trip.findOne({ tripId: req.params.id });
    if (!doc) throw new HttpError(404, 'Trip not found');

    const oldVehicleId = doc.vehicleId;
    const oldDriverId = doc.driverId;
    const incomplete = !doc.completedAt;
    let replacementDriver = null;
    if (incomplete) {
      if (vehicle.active !== 'Yes') throw new HttpError(422, `Vehicle ${vehicleNo} is inactive`);
      if (!vehicle.driverId) throw new HttpError(422, `Vehicle ${vehicleNo} has no assigned driver`);
      replacementDriver = await Driver.findById(vehicle.driverId);
      if (!replacementDriver || replacementDriver.active !== 'Yes') {
        throw new HttpError(422, `Vehicle ${vehicleNo} does not have an active assigned driver`);
      }
    }
    doc.vehicleId = vehicle._id;
    doc.vendor = vehicle.vendor;
    // Ongoing/future trips follow the new vehicle's driver; a completed trip's
    // driver history stays untouched — only the vehicle number is corrected.
    if (incomplete && replacementDriver) {
      doc.driverId = replacementDriver._id;
      if (String(oldVehicleId) !== String(vehicle._id) || String(oldDriverId) !== String(replacementDriver._id)) {
        doc.reassignmentHistory.push({
          at: new Date(), by: req.auth!.sub as never, reason: String(reason).trim().slice(0, 200) || 'vehicle-reassignment',
          oldVehicleId, newVehicleId: vehicle._id, oldDriverId, newDriverId: replacementDriver._id,
        });
      }
    }
    await doc.save();
    const fresh = await Trip.findById(doc._id).populate(TRIP_POPULATE);
    const populated = fresh as unknown as Populated;
    const dto = toTripDTO(populated);

    emitTripStatus({
      trip: dto,
      driverId: populated.driverId?._id.toString() ?? '',
      employeeIds: populated.employeeIds.map((e) => e._id.toString()),
    });
    if (incomplete && populated.driverId) {
      if (oldDriverId && String(oldDriverId) !== String(populated.driverId._id)) {
        emitTripUnassigned(oldDriverId.toString(), { tripId: doc.tripId, reason: String(reason).trim() || 'Vehicle reassigned' });
      }
      if (doc.frozen) {
        emitTripFrozen({
          adminTrip: dto,
          driverTrip: toDriverTripDTO(populated as Parameters<typeof toDriverTripDTO>[0]),
          driverId: populated.driverId._id.toString(),
          employeeTrips: populated.employeeIds.map((employee) => ({
            employeeId: employee._id.toString(),
            trip: toEmployeeTripDTO(populated as Parameters<typeof toEmployeeTripDTO>[0], employee._id),
          })),
        });
        await sendDriverTripPush({
          driverId: populated.driverId._id,
          tripId: doc.tripId,
          tripType: doc.type,
          date: doc.date,
          time: doc.shiftTime,
        }).catch((error) => console.error(`[push] Driver trip ${doc.tripId} failed:`, (error as Error).message));
      }
    }
    res.json(dto);
  })
);

// Sends the assigned driver a reminder with a direct link to the driver web
// app. The lock endpoint itself already publishes the trip to both apps.
tripsRouter.post(
  '/:id/notify-driver',
  idempotent(),
  asyncHandler(async (req, res) => {
    const doc = await Trip.findOne({ tripId: req.params.id }).populate(TRIP_POPULATE);
    if (!doc) throw new HttpError(404, 'Trip not found');
    if (!doc.frozen) throw new HttpError(409, 'Lock the trip before sending it to the driver');
    const populated = doc as unknown as Populated;
    const driver = populated.driverId;
    if (!driver?.contact) throw new HttpError(422, 'The assigned driver has no phone number');

    const link = `${env.driverAppPublicUrl}/trip/${encodeURIComponent(doc.tripId)}`;
    const body = [
      `Trip ${doc.tripId}: ${doc.type} on ${doc.date} ${doc.shiftTime || ''}`.trim(),
      `Route: ${populated.routeId?.name || doc.location || 'Not set'}`,
      `Vehicle: ${populated.vehicleId?.rtoNo || 'Not set'}`,
      `Employees: ${populated.employeeIds.length}`,
      `Open driver app: ${link}`,
    ].join(' | ');
    let deliveryId = '';
    try {
      const delivery = await sendCompanySms({
        phone: driver.contact,
        kind: 'trip-driver',
        // Fast2SMS Message ID 224774: trip ID, then scheduled date/time.
        // The approved Driver-app URL is static text owned by the template.
        variables: [
          dltTextVariable([doc.tripId]),
          dltTextVariable([doc.date, doc.shiftTime]),
        ],
        fallbackBody: body,
        referenceId: doc._id.toString(),
        retryPolicy: { dedupeUncertain: true, maxAttempts: 3, baseDelayMs: 60_000 },
      });
      deliveryId = delivery.deliveryId;
      doc.driverSmsSentAt = new Date();
      doc.driverSmsError = '';
      await doc.save();
    } catch (error) {
      doc.driverSmsError = error instanceof Error ? error.message.slice(0, 500) : 'SMS delivery failed';
      await doc.save();
      throw error;
    }
    res.json({
      sent: true,
      status: 'accepted',
      deliveryId,
      acceptedAt: doc.driverSmsSentAt?.toISOString() ?? null,
    });
  })
);

// PUT /api/trips/:id/escort — set whether a trip has an escort, plus optional name.
tripsRouter.put(
  '/:id/escort',
  asyncHandler(async (req, res) => {
    const { escort, escortName } = req.body as { escort?: string; escortName?: string };
    if (escort !== 'Yes' && escort !== 'No') {
      throw new HttpError(400, "escort must be 'Yes' or 'No'");
    }
    const doc = await Trip.findOne({ tripId: req.params.id });
    if (!doc) throw new HttpError(404, 'Trip not found');

    doc.escort = escort;
    // No escort -> name is meaningless; store name only when escort is present.
    doc.escortName = escort === 'Yes' ? (escortName ?? '').trim() : '';
    await doc.save();
    await doc.populate(TRIP_POPULATE);
    const populated = doc as unknown as Populated;
    const dto = toTripDTO(populated);

    emitTripStatus({
      trip: dto,
      driverId: populated.driverId?._id.toString() ?? '',
      employeeIds: populated.employeeIds.map((e) => e._id.toString()),
    });
    res.json(dto);
  })
);

// Manual employee reach times. The trip date comes from rostering; admins enter
// only a local Asia/Kolkata time (HH:mm) for each employee.
tripsRouter.put(
  '/:id/schedule',
  asyncHandler(async (req, res) => {
    if (!['admin', 'staff', 'platform-owner'].includes(req.auth?.role ?? '')) {
      throw new HttpError(403, 'Only an administrator or staff member can edit schedules');
    }
    const doc = await Trip.findOne({ tripId: req.params.id }).populate(TRIP_POPULATE);
    if (!doc) throw new HttpError(404, 'Trip not found');
    const populated = doc as unknown as Populated;
    const body = req.body as { stops?: { employeeId: string; reachTime: string }[] };
    if (!Array.isArray(body.stops) || body.stops.length === 0) {
      throw new HttpError(400, 'Employee reach times are required');
    }
    const employees = new Map(populated.employeeIds.map((employee) => [employee.empId, employee]));
    const submitted = new Set<string>();
    doc.scheduleStops = body.stops.map((override, index) => {
      const employee = employees.get(String(override.employeeId ?? '').trim());
      if (!employee) throw new HttpError(400, `Employee ${override.employeeId} is not assigned to this trip`);
      if (submitted.has(employee.empId)) throw new HttpError(400, `Duplicate employee ${employee.empId}`);
      submitted.add(employee.empId);
      return {
        employeeId: employee._id,
        sequence: index + 1,
        plannedAt: reachTimeOnTripDate(doc.date, override.reachTime),
        liveEtaAt: undefined,
        distanceMeters: 0,
        durationSeconds: 0,
      };
    });
    if (submitted.size !== populated.employeeIds.length) {
      throw new HttpError(400, 'Enter a driver reach time for every employee');
    }
    doc.scheduleMode = 'manual';
    doc.scheduleCalculatedAt = new Date();
    doc.etaUpdatedAt = new Date();
    await doc.save();
    await doc.populate(TRIP_POPULATE);
    const updated = doc as unknown as Populated;
    broadcastSchedule(updated);
    res.json(toTripDTO(updated));
  })
);

tripsRouter.put(
  '/:id/freeze',
  asyncHandler(async (req, res) => {
    const tripId = req.params.id;
    const doc = await Trip.findOne({ tripId });
    if (!doc) throw new HttpError(404, 'Trip not found');
    if (doc.frozen) {
      await doc.populate(TRIP_POPULATE);
      return res.json(toTripDTO(doc as unknown as Populated));
    }
    doc.frozen = true;
    await doc.save();
    await doc.populate(TRIP_POPULATE);
    const populated = doc as unknown as Populated;
    const dto = toTripDTO(populated);

    // Notify the assigned driver and employees in real time.
    emitTripFrozen({
      adminTrip: dto,
      driverTrip: toDriverTripDTO(populated as Parameters<typeof toDriverTripDTO>[0]),
      driverId: populated.driverId?._id.toString() ?? '',
      employeeTrips: populated.employeeIds.map((employee) => ({
        employeeId: employee._id.toString(),
        trip: toEmployeeTripDTO(
          populated as Parameters<typeof toEmployeeTripDTO>[0],
          employee._id
        ),
      })),
    });
    if (populated.driverId) {
      await sendDriverTripPush({
        driverId: populated.driverId._id,
        tripId: doc.tripId,
        tripType: doc.type,
        date: doc.date,
        time: doc.shiftTime,
      }).catch((error) => console.error(`[push] Driver trip ${doc.tripId} failed:`, (error as Error).message));
    }
    res.json(dto);
  })
);
