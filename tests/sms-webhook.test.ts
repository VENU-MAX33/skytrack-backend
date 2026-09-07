import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb } from './helpers.js';
import { SmsDelivery } from '../src/models/SmsDelivery.js';
import { sendCompanySms } from '../src/services/sms.service.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('Fast2SMS webhook records a delivered status idempotently', async () => {
  const delivery = await SmsDelivery.create({
    kind: 'login-otp', recipient: '9845000111', provider: 'fast2sms', route: 'dlt',
    requestId: 'REQ-1', status: 'accepted', referenceId: 'OTP-1',
  });
  const payload = {
    request_id: 'REQ-1', udf1: delivery._id.toString(), status: 'delivered',
    delivery_timestamp: 1_800_000_000, sms_count: 1, amount_debited: '0.25',
  };
  const first = await request(app).post('/api/webhooks/fast2sms/delivery/test-fast2sms-webhook-secret').send(payload);
  const second = await request(app).post('/api/webhooks/fast2sms/delivery/test-fast2sms-webhook-secret').send(payload);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const updated = await SmsDelivery.findById(delivery._id);
  assert.equal(updated?.status, 'delivered');
  assert.equal(updated?.smsCount, 1);
  assert.equal(updated?.amountDebited, 0.25);
});

test('Fast2SMS webhook rejects the wrong secret', async () => {
  const response = await request(app).post('/api/webhooks/fast2sms/delivery/wrong-secret').send({ status: 'delivered' });
  assert.equal(response.status, 404);
});

test('an unknown provider outcome blocks a duplicate charge for the same event', async () => {
  await SmsDelivery.create({
    kind: 'otp-escalation', recipient: '9845000111', provider: 'fast2sms', route: 'dlt',
    requestId: '', status: 'unknown', referenceId: 'TRIP-UNKNOWN', attempt: 1,
  });

  await assert.rejects(
    () => sendCompanySms({
      phone: '9845000111', kind: 'otp-escalation', variables: ['TRIP-UNKNOWN', '2'],
      fallbackBody: 'Two OTPs pending', referenceId: 'TRIP-UNKNOWN',
      retryPolicy: { dedupeUncertain: true, maxAttempts: 3, baseDelayMs: 60_000 },
    }),
    /already pending, accepted, delivered, or awaiting delivery confirmation/,
  );
  assert.equal(await SmsDelivery.countDocuments({ referenceId: 'TRIP-UNKNOWN' }), 1);
});
