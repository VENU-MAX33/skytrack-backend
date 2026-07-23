import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee } from './helpers.js';
import { OTP } from '../src/models/OTP.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

// C-2: the OTP code must never be returned to the client (HTTP or WebSocket).
// In dev mode it was echoed back as `devCode`, making OTP login a no-op for
// anyone who knows a registered phone number.

test('driver request-otp does not leak the OTP code in the response', async () => {
  const driver = await makeDriver({ contact: '9845000123' });
  const res = await request(app)
    .post('/api/driver/request-otp')
    .send({ phone: driver.contact });

  assert.equal(res.status, 200);
  assert.equal(res.body.sent, true);
  assert.ok(!('devCode' in res.body), 'response must not contain devCode');
  assert.ok(!('code' in res.body), 'response must not contain code');
  // The OTP was still generated and stored server-side (delivered via SMS only).
  assert.equal(await OTP.countDocuments({ phone: driver.contact }), 1);
});

test('employee request-otp does not leak the OTP code in the response', async () => {
  const emp = await makeEmployee({ contact: '9886000123' });
  const res = await request(app)
    .post('/api/employee/request-otp')
    .send({ phone: emp.contact });

  assert.equal(res.status, 200);
  assert.equal(res.body.sent, true);
  assert.ok(!('devCode' in res.body), 'response must not contain devCode');
  assert.ok(!('code' in res.body), 'response must not contain code');
});

test('driver verify-otp still issues a token for a valid code', async () => {
  const driver = await makeDriver({ contact: '9845000999' });
  // Seed a known OTP the way sendOtp would (hashed, unconsumed, not expired).
  await OTP.create({
    purpose: 'login',
    phone: driver.contact,
    otpHash: await bcrypt.hash('654321', 10),
    driverId: driver._id,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  const res = await request(app)
    .post('/api/driver/verify-otp')
    .send({ phone: driver.contact, code: '654321' });

  assert.equal(res.status, 200);
  assert.ok(typeof res.body.token === 'string' && res.body.token.length > 0);
  assert.equal(res.body.user.role, 'driver');
});

test('driver verify-otp rejects an incorrect code', async () => {
  const driver = await makeDriver({ contact: '9845000888' });
  await OTP.create({
    purpose: 'login',
    phone: driver.contact,
    otpHash: await bcrypt.hash('111111', 10),
    driverId: driver._id,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  const res = await request(app)
    .post('/api/driver/verify-otp')
    .send({ phone: driver.contact, code: '999999' });

  assert.equal(res.status, 400);
});
