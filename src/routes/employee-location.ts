import { Router } from 'express';
import { Types } from 'mongoose';
import { Employee } from '../models/Employee.js';
import { Trip } from '../models/Trip.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { emitEmployeeLocation } from '../websocket/index.js';
import { LocationRequest } from '../models/LocationRequest.js';

export const employeeLocationRouter = Router();

// GET /api/employee/location/requests — persisted requests also cover users
// who were offline when the driver pressed Request location.
employeeLocationRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const employeeId = new Types.ObjectId(req.auth!.sub);
    const docs = await LocationRequest.find({ employeeId, status: 'pending' })
      .sort({ requestedAt: -1 }).limit(20).populate('driverId tripId');
    res.json(docs.map((doc) => ({
      id: doc._id.toString(),
      tripId: (doc.tripId as unknown as { tripId?: string }).tripId ?? '',
      driverName: (doc.driverId as unknown as { name?: string }).name ?? 'Your driver',
      requestedAt: doc.requestedAt.toISOString(),
    })));
  })
);

// POST /api/employee/location — employee shares live GPS to their trip driver + admin
employeeLocationRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { tripId, lat, lng } = req.body as { tripId?: string; lat?: number; lng?: number };
    if (!tripId || lat == null || lng == null) {
      throw new HttpError(400, 'tripId, lat and lng are required');
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new HttpError(400, 'lat must be a number between -90 and 90');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new HttpError(400, 'lng must be a number between -180 and 180');
    }

    const selfObjectId = new Types.ObjectId(req.auth!.sub);

    const employee = await Employee.findById(selfObjectId);
    if (!employee) throw new HttpError(404, 'Employee not found');

    const trip = await Trip.findOne({ tripId, employeeIds: selfObjectId });
    if (!trip) throw new HttpError(404, 'Trip not found or you are not on this trip');

    emitEmployeeLocation({
      employeeMongoId: selfObjectId.toString(),
      empId: employee.empId,
      empName: employee.name,
      tripId,
      lat,
      lng,
      timestamp: new Date().toISOString(),
      driverMongoId: trip.driverId?.toString(),
    });

    await LocationRequest.updateMany(
      { tripId: trip._id, employeeId: selfObjectId, status: 'pending' },
      { $set: { status: 'shared', sharedAt: new Date() } }
    );

    res.json({ ok: true });
  })
);
