import { Router } from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { SmsDelivery } from '../models/SmsDelivery.js';

export const smsDeliveriesRouter = Router();

smsDeliveriesRouter.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '25'), 10) || 25));
  const status = typeof req.query.status === 'string' && ['pending', 'accepted', 'delivered', 'failed', 'unknown'].includes(req.query.status)
    ? req.query.status : '';
  const docs = await SmsDelivery.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(docs.map((doc) => ({
    id: doc._id.toString(),
    kind: doc.kind,
    recipient: `******${doc.recipient.slice(-4)}`,
    route: doc.route,
    status: doc.status,
    requestId: doc.requestId,
    referenceId: doc.referenceId,
    smsCount: doc.smsCount ?? null,
    amountDebited: doc.amountDebited ?? null,
    failureReason: doc.failureReason,
    acceptedAt: doc.acceptedAt?.toISOString() ?? null,
    deliveredAt: doc.deliveredAt?.toISOString() ?? null,
    failedAt: doc.failedAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
  })));
}));
