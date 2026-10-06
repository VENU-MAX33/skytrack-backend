import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app, clearDb, makeAdmin, startTestDb, stopTestDb } from './helpers.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('rejects MongoDB operator keys before authentication handlers run', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email: { $ne: null }, password: 'anything' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Request contains a forbidden field name');
});

test('requires JSON for mutating requests with bodies', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'text/plain')
    .send('email=test@example.com&password=test');

  assert.equal(response.status, 415);
});

test('does not reflect an unsafe request id into the response', async () => {
  const response = await request(app)
    .get('/api/health/live')
    .set('X-Request-Id', 'unsafe request id with spaces');

  assert.equal(response.status, 200);
  assert.match(String(response.headers['x-request-id']), /^[a-f0-9-]{36}$/);
});

test('rejects JWTs without the required issuer and audience', async () => {
  const admin = await makeAdmin();
  const token = jwt.sign(
    { sub: admin._id.toString(), role: 'admin', companyId: admin.companyId?.toString() },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  );

  const response = await request(app)
    .get('/api/dashboard')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 401);
});
