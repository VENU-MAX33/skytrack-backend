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
    const now = new Date();
    await LocationRequest.updateMany(
      { employeeId, status: 'pending', expiresAt: { $lte: now } },
      { $set: { status: 'expired' } }
    );
    const docs = await LocationRequest.find({
      employeeId,
      status: 'pending',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
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
    const { requestId, tripId, lat, lng } = req.body as {
      requestId?: string;
      tripId?: string;
      lat?: number;
      lng?: number;
    };
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

    let requestDoc = null;
    if (requestId) {
      if (!Types.ObjectId.isValid(requestId)) throw new HttpError(400, 'Invalid location request id');
      requestDoc = await LocationRequest.findOne({
        _id: requestId,
        employeeId: selfObjectId,
        status: 'pending',
      });
      if (!requestDoc) throw new HttpError(404, 'Location request was not found or has already been answered');
      if (requestDoc.expiresAt && requestDoc.expiresAt.getTime() <= Date.now()) {
        requestDoc.status = 'expired';
        await requestDoc.save();
        throw new HttpError(409, 'This location request has expired');
      }
    }

    const trip = requestDoc
      ? await Trip.findOne({ _id: requestDoc.tripId, tripId, employeeIds: selfObjectId })
      : await Trip.findOne({ tripId, employeeIds: selfObjectId });
    if (!trip) throw new HttpError(404, 'Trip not found or you are not on this trip');
    if (trip.completedAt || ['Completed', 'Completed Late', 'Auto Cancelled'].includes(trip.status)) {
      throw new HttpError(409, 'Location cannot be shared for a completed trip');
    }

    const sharedAt = new Date();

    emitEmployeeLocation({
      requestId: requestDoc?._id.toString(),
      employeeMongoId: selfObjectId.toString(),
      empId: employee.empId,
      empName: employee.name,
      tripId,
      lat,
      lng,
      timestamp: sharedAt.toISOString(),
      driverMongoId: trip.driverId?.toString(),
    });

    if (requestDoc) {
      requestDoc.status = 'shared';
      requestDoc.sharedAt = sharedAt;
      requestDoc.sharedLat = lat;
      requestDoc.sharedLng = lng;
      await requestDoc.save();
    }

    res.json({ ok: true, requestId: requestDoc?._id.toString() ?? null, sharedAt: sharedAt.toISOString() });
  })
);
