import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  app,
  clearDb,
  makeAdmin,
  makeDriver,
  makeEmployee,
  startTestDb,
  stopTestDb,
  tokenFor,
} from './helpers.js';
import { Route } from '../src/models/Route.js';
import { Vehicle } from '../src/models/Vehicle.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function setupScheduledTrip() {
  const admin = await makeAdmin('admin');
  const token = tokenFor(admin._id.toString(), 'admin');
  const driver = await makeDriver();
  await Route.create({ routeId: 1, name: 'South Route', type: 'Both' });
  await Vehicle.create({
    rtoNo: 'KA01MX1000',
    vendor: 'Monitor Cabs',
    driverId: driver._id,
    active: 'Yes',
    lat: 12.9716,
    lng: 77.5946,
  });
  await makeEmployee({
    empId: 'EMP100',
    name: 'Scheduled Employee',
    route: 'South Route',
    distance: '8',
    latLong: '12.9352,77.6245',
  });
  const created = await request(app)
    .post('/api/trips')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'PickUp',
      date: '2026-07-17',
      shiftTime: '09:00',
      vehicleNo: 'KA01MX1000',
      routeName: 'South Route',
      employeeIds: ['EMP100'],
    });
  assert.equal(created.status, 201);
  return { token, trip: created.body };
}

test('trip creation waits for manually entered employee reach times', async () => {
  const { trip } = await setupScheduledTrip();
  assert.equal(trip.schedule, null);
});

test('admin can save a time-only employee reach schedule', async () => {
  const { token, trip } = await setupScheduledTrip();
  const manual = await request(app)
    .put(`/api/trips/${trip.id}/schedule`)
    .set('Authorization', `Bearer ${token}`)
    .send({ stops: [{ employeeId: 'EMP100', reachTime: '08:15' }] });
  assert.equal(manual.status, 200);
  assert.equal(manual.body.schedule.mode, 'manual');
  assert.equal(manual.body.schedule.stops[0].employeeId, 'EMP100');
  assert.equal(manual.body.schedule.stops[0].plannedAt, '2026-07-17T02:45:00.000Z');
});

test('trip locks and publishes without manual employee reach times', async () => {
  const { token, trip } = await setupScheduledTrip();
  const frozen = await request(app)
    .put(`/api/trips/${trip.id}/freeze`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(frozen.status, 200);
  assert.equal(frozen.body.frozen, true);
});
