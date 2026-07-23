import { Router } from 'express';
import crypto from 'crypto';
import { Vehicle } from '../models/Vehicle.js';
import { CompanyConfig } from '../models/CompanyConfig.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { emitVehiclePosition } from '../websocket/index.js';

export const driverTrackingRouter = Router();

function newKey(): string {
  return crypto.randomBytes(8).toString('hex'); // 16 hex chars, like "97aba55531b2242e"
}

async function findMyVehicle(driverId: string) {
  return Vehicle.findOne({ driverId, active: 'Yes' });
}

// GET /api/driver/tracking — tracking key + linked vehicle for the authed driver.
// Generates a key on first access so the screen always has one to show.
driverTrackingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const vehicle = await findMyVehicle(req.auth!.sub);
    const company = await CompanyConfig.findOne();
    if (!vehicle) {
      res.json({ trackingKey: null, vehicle: null, company: company?.name ?? '' });
      return;
    }
    let trackingKey = vehicle.trackingKey;
    if (!trackingKey) {
      await Vehicle.updateOne(
        { _id: vehicle._id, $or: [{ trackingKey: '' }, { trackingKey: { $exists: false } }] },
        { $set: { trackingKey: newKey() } }
      );
      const freshVehicle = await Vehicle.findById(vehicle._id).select('trackingKey').lean();
      trackingKey = freshVehicle?.trackingKey ?? '';
    }
    res.json({
      trackingKey,
      vehicle: { rtoNo: vehicle.rtoNo, imei: vehicle.imei },
      company: company?.name ?? '',
    });
  })
);

// PUT /api/driver/tracking/key — rotate the key (lost phone / driver change).
driverTrackingRouter.put(
  '/key',
  asyncHandler(async (req, res) => {
    const vehicle = await findMyVehicle(req.auth!.sub);
    if (!vehicle) throw new HttpError(404, 'No vehicle is assigned to you');
    vehicle.trackingKey = newKey();
    await vehicle.save();
    res.json({ trackingKey: vehicle.trackingKey });
  })
);

// POST /api/driver/tracking/ping — phone GPS position for the driver's vehicle.
driverTrackingRouter.post(
  '/ping',
  asyncHandler(async (req, res) => {
    const { key, lat, lng, speed } = req.body as {
      key?: string;
      lat?: number;
      lng?: number;
      speed?: number;
    };
    if (!key || lat == null || lng == null) {
      throw new HttpError(400, 'key, lat and lng are required');
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new HttpError(400, 'lat must be a number between -90 and 90');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new HttpError(400, 'lng must be a number between -180 and 180');
    }
    if (speed !== undefined && (!Number.isFinite(speed) || speed < 0 || speed > 300)) {
      throw new HttpError(400, 'speed must be a number between 0 and 300');
    }
    const vehicle = await findMyVehicle(req.auth!.sub);
    if (!vehicle) throw new HttpError(404, 'No vehicle is assigned to you');
    if (vehicle.trackingKey !== key) {
      throw new HttpError(403, 'Tracking key does not match — refresh the Vehicle Tracking screen');
    }

    const kmh = Math.max(0, speed ?? 0);
    vehicle.lat = lat;
    vehicle.lng = lng;
    vehicle.speed = Math.round(kmh);
    vehicle.trackStatus = kmh > 2 ? 'running' : 'idle';
    vehicle.lastPingAt = new Date();
    await vehicle.save();

    emitVehiclePosition({
      rtoNo: vehicle.rtoNo,
      lat: vehicle.lat,
      lng: vehicle.lng,
      status: vehicle.trackStatus,
      speed: vehicle.speed,
    });
    res.json({ ok: true });
  })
);
