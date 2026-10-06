import { Router } from 'express';
import { DriverPushDevice } from '../models/DriverPushDevice.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

export const driverNotificationsRouter = Router();

driverNotificationsRouter.post('/push/register', asyncHandler(async (req, res) => {
  const token = String((req.body as { token?: string }).token ?? '').trim();
  if (token.length < 20 || token.length > 4096) throw new HttpError(400, 'A valid push token is required');
  await DriverPushDevice.findOneAndUpdate(
    { token },
    { $set: { driverId: req.auth!.sub, platform: 'android', active: true, lastSeenAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ registered: true });
}));

driverNotificationsRouter.put('/push/unregister', asyncHandler(async (req, res) => {
  const token = String((req.body as { token?: string }).token ?? '').trim();
  if (token) await DriverPushDevice.updateMany({ driverId: req.auth!.sub, token }, { $set: { active: false } });
  else await DriverPushDevice.updateMany({ driverId: req.auth!.sub }, { $set: { active: false } });
  res.json({ registered: false });
}));
