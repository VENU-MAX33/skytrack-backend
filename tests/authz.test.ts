import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee, makeAdmin, tokenFor } from './helpers.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

// C-1: back-office data endpoints must reject low-trust (driver/employee) tokens.
// These were mounted with requireAuth (any valid token) and leaked all PII,
// including every driver's Aadhaar/PAN.

test('GET /api/drivers rejects an employee token with 403', async () => {
  const emp = await makeEmployee();
  const res = await request(app)
    .get('/api/drivers')
    .set('Authorization', `Bearer ${tokenFor(emp._id.toString(), 'employee')}`);
  assert.equal(res.status, 403);
});

test('GET /api/drivers rejects a driver token with 403', async () => {
  const driver = await makeDriver();
  const res = await request(app)
    .get('/api/drivers')
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);
  assert.equal(res.status, 403);
});

test('GET /api/employees rejects a driver token with 403', async () => {
  const driver = await makeDriver();
  const res = await request(app)
    .get('/api/employees')
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);
  assert.equal(res.status, 403);
});

// Every back-office list endpoint must reject a low-trust driver/employee token.
const BACK_OFFICE_GET_PATHS = [
  '/api/employees',
  '/api/vehicles',
  '/api/drivers',
  '/api/routes',
  '/api/company-config',
  '/api/trips',
  '/api/rosters',
  '/api/dashboard',
  '/api/notifications',
];

for (const path of BACK_OFFICE_GET_PATHS) {
  test(`GET ${path} rejects a driver token with 403`, async () => {
    const driver = await makeDriver();
    const res = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);
    assert.equal(res.status, 403);
  });
}

test('GET /api/drivers still returns 401 without a token', async () => {
  const res = await request(app).get('/api/drivers');
  assert.equal(res.status, 401);
});

test('GET /api/drivers allows the main admin (200, no Aadhaar leak to low-trust)', async () => {
  const admin = await makeAdmin('admin');
  await makeDriver();
  const res = await request(app)
    .get('/api/drivers')
    .set('Authorization', `Bearer ${tokenFor(admin._id.toString(), 'admin')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
});

test('GET /api/drivers allows a staff login (200)', async () => {
  const staff = await makeAdmin('staff');
  await makeDriver();
  const res = await request(app)
    .get('/api/drivers')
    .set('Authorization', `Bearer ${tokenFor(staff._id.toString(), 'staff')}`);
  assert.equal(res.status, 200);
});
