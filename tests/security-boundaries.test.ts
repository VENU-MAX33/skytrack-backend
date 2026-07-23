import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, makeAdmin, makeDriver, makeEmployee, startTestDb, stopTestDb, tokenFor } from './helpers.js';
import { principalIsValid } from '../src/middleware/auth.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';
import { Trip } from '../src/models/Trip.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('staff can read back-office data but cannot mutate it', async () => {
  const staff = await makeAdmin('staff');
  const token = tokenFor(staff._id.toString(), 'staff');

  const list = await request(app).get('/api/employees').set('Authorization', `Bearer ${token}`);
  const create = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ empId: 'STAFF-WRITE', name: 'Should Not Exist', contact: '9000000011' });

  assert.equal(list.status, 200);
  assert.equal(create.status, 403);
});

test('deactivated principals fail the validation used by REST and WebSocket authentication', async () => {
  const driver = await makeDriver();
  const payload = { sub: driver._id.toString(), role: 'driver' as const, companyId: driver.companyId.toString() };
  assert.equal(await principalIsValid(payload), true);
  driver.active = 'No';
  await driver.save();
  assert.equal(await principalIsValid(payload), false);
});

test('employee cannot raise SOS or change escort state for another employee trip', async () => {
  const [employeeA, employeeB, driver] = await Promise.all([makeEmployee(), makeEmployee(), makeDriver()]);
  const vehicle = await Vehicle.create({ rtoNo: 'KA01TEST', driverId: driver._id });
  const route = await Route.create({ routeId: 1, name: 'Security Route' });
  const trip = await Trip.create({
    tripId: 'TRIP-OTHER', type: 'PickUp', date: '2026-07-16',
    vehicleId: vehicle._id, driverId: driver._id, routeId: route._id,
    employeeIds: [employeeB._id],
  });
  const token = tokenFor(employeeA._id.toString(), 'employee');

  const sos = await request(app)
    .post('/api/sos')
    .set('Authorization', `Bearer ${token}`)
    .send({ tripId: trip.tripId, reason: 'false alert' });
  const escort = await request(app)
    .post('/api/escort-report')
    .set('Authorization', `Bearer ${token}`)
    .send({ tripId: trip.tripId, present: 'Yes', escortName: 'Unknown' });

  assert.equal(sos.status, 404);
  assert.equal(escort.status, 404);
  const unchanged = await Trip.findById(trip._id);
  assert.equal(unchanged?.escort, 'No');
});
