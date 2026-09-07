import crypto from 'node:crypto';
import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { env } from '../config/env.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { SmsDelivery } from '../models/SmsDelivery.js';

export const smsWebhookRouter = Router();

function secretMatches(received: string): boolean {
  if (!env.fast2smsWebhookSecret) return false;
  const actual = Buffer.from(received);
  const expected = Buffer.from(env.fast2smsWebhookSecret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function providerDate(timestamp: unknown): Date | undefined {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

smsWebhookRouter.post(
  '/delivery/:secret',
  asyncHandler(async (req, res) => {
    if (!env.fast2smsWebhookSecret) throw new HttpError(503, 'SMS delivery webhook is not configured');
    if (!secretMatches(req.params.secret)) throw new HttpError(404, 'Not found');

    const body = req.body as Record<string, unknown>;
    const requestId = String(body.request_id ?? body.msg_id ?? '').trim();
    const internalId = String(body.udf1 ?? '').trim();
    const delivery = isValidObjectId(internalId)
      ? await SmsDelivery.findById(internalId)
      : requestId ? await SmsDelivery.findOne({ requestId }) : null;
    if (!delivery) {
      // Acknowledge unknown provider events so Fast2SMS does not retry forever.
      res.status(202).json({ received: true, matched: false });
      return;
    }

    const status = String(body.status ?? '').toLowerCase();
    const reason = String(body.failure_reason ?? body.status_description ?? body.description ?? '').slice(0, 500);
    if (status === 'delivered') {
      delivery.status = 'delivered';
      delivery.deliveredAt = providerDate(body.delivery_timestamp) ?? delivery.deliveredAt ?? new Date();
      delivery.failureReason = '';
    } else if (['failed', 'rejected', 'undelivered', 'expired'].includes(status)) {
      delivery.status = 'failed';
      delivery.failedAt = providerDate(body.delivery_timestamp) ?? new Date();
      delivery.failureReason = reason || `Provider reported ${status}`;
    }
    if (!delivery.requestId && requestId) delivery.requestId = requestId;
    const smsCount = Number(body.sms_count);
    const amountDebited = Number(body.amount_debited);
    if (Number.isFinite(smsCount) && smsCount >= 0) delivery.smsCount = smsCount;
    if (Number.isFinite(amountDebited) && amountDebited >= 0) delivery.amountDebited = amountDebited;
    await delivery.save();
    res.json({ received: true, matched: true });
  }),
);
