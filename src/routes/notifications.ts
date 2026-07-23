import { Router } from 'express';
import { Notification } from '../models/Notification.js';
import { toNotificationDTO } from '../services/notification.service.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';

export const notificationsRouter = Router();

// GET /api/notifications — admin: recent notifications, newest first
notificationsRouter.get(
  '/',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (_req, res) => {
    const docs = await Notification.find().sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ read: false });
    res.json({ items: docs.map(toNotificationDTO), unread });
  })
);

// PUT /api/notifications/read-all — admin: mark everything read
notificationsRouter.put(
  '/read-all',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (_req, res) => {
    await Notification.updateMany({ read: false }, { read: true });
    res.json({ ok: true });
  })
);

// PUT /api/notifications/:id/read — admin: mark one read
notificationsRouter.put(
  '/:id/read',
  requireRole('platform-owner', 'admin'),
  asyncHandler(async (req, res) => {
    const doc = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    if (!doc) throw new HttpError(404, 'Notification not found');
    res.json(toNotificationDTO(doc));
  })
);
