import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { EmployeeNotification } from '../models/EmployeeNotification.js';
import { PushDevice } from '../models/PushDevice.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { toEmployeeNotificationDTO } from '../services/employee-notification.service.js';

export const employeeNotificationsRouter = Router();

employeeNotificationsRouter.get('/', asyncHandler(async (req, res) => {
  const employeeId = req.auth!.sub;
  const [docs, unread] = await Promise.all([
    EmployeeNotification.find({ employeeId }).sort({ createdAt: -1 }).limit(50),
    EmployeeNotification.countDocuments({ employeeId, read: false }),
  ]);
  res.json({ items: docs.map(toEmployeeNotificationDTO), unread });
}));

employeeNotificationsRouter.put('/read-all', asyncHandler(async (req, res) => {
  await EmployeeNotification.updateMany({ employeeId: req.auth!.sub, read: false }, { $set: { read: true } });
  res.json({ ok: true });
}));

employeeNotificationsRouter.put('/:id/read', asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Notification not found');
  const doc = await EmployeeNotification.findOneAndUpdate(
    { _id: req.params.id, employeeId: req.auth!.sub },
    { $set: { read: true } },
    { new: true },
  );
  if (!doc) throw new HttpError(404, 'Notification not found');
  res.json(toEmployeeNotificationDTO(doc));
}));

employeeNotificationsRouter.post('/push/register', asyncHandler(async (req, res) => {
  const token = String((req.body as { token?: string }).token ?? '').trim();
  if (token.length < 20 || token.length > 4096) throw new HttpError(400, 'A valid push token is required');
  await PushDevice.findOneAndUpdate(
    { token },
    { $set: { employeeId: req.auth!.sub, platform: 'android', app: 'employee', active: true, lastSeenAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({ registered: true });
}));

employeeNotificationsRouter.put('/push/unregister', asyncHandler(async (req, res) => {
  const token = String((req.body as { token?: string }).token ?? '').trim();
  if (token) await PushDevice.updateMany({ employeeId: req.auth!.sub, token }, { $set: { active: false } });
  else await PushDevice.updateMany({ employeeId: req.auth!.sub }, { $set: { active: false } });
  res.json({ registered: false });
}));
