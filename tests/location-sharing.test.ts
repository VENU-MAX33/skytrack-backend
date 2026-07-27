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

test('requested employee location is persisted for an offline driver and can be acknowledged', async () => {
  const admin = await makeAdmin('admin');
  const driver = await makeDriver();
  const employee = await makeEmployee({ empId: 'EMP-LOC', route: 'Location Route' });
  await Route.create({ routeId: 50, name: 'Location Route', type: 'Both' });
  await Vehicle.create({
    rtoNo: 'KA01LOC001',
    vendor: 'Monitor Cabs',
    driverId: driver._id,
    active: 'Yes',
  });
  const adminToken = tokenFor(admin._id.toString(), 'admin');
  const created = await request(app)
    .post('/api/trips')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      type: 'PickUp',
      date: '2099-07-27',
      shiftTime: '09:00',
      vehicleNo: 'KA01LOC001',
      routeName: 'Location Route',
      employeeIds: ['EMP-LOC'],
      scheduleStops: [{ employeeId: 'EMP-LOC', reachTime: '08:15' }],
    });
  const frozen = await request(app)
    .put(`/api/trips/${created.body.id}/freeze`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  assert.equal(frozen.status, 200);

  const driverToken = tokenFor(driver._id.toString(), 'driver');
  const employeeToken = tokenFor(employee._id.toString(), 'employee');
  const requested = await request(app)
    .post(`/api/driver/trips/${created.body.id}/location-requests/EMP-LOC`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({});
  assert.equal(requested.status, 201);

  const pending = await request(app)
    .get('/api/employee/location/requests')
    .set('Authorization', `Bearer ${employeeToken}`);
  assert.equal(pending.status, 200);
  assert.equal(pending.body[0].id, requested.body.id);

  const shared = await request(app)
    .post('/api/employee/location')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({
      requestId: requested.body.id,
      tripId: created.body.id,
      lat: 12.9716,
      lng: 77.5946,
    });
  assert.equal(shared.status, 200);

  const responses = await request(app)
    .get('/api/driver/trips/location-responses')
    .set('Authorization', `Bearer ${driverToken}`);
  assert.equal(responses.status, 200);
  assert.equal(responses.body[0].requestId, requested.body.id);
  assert.equal(responses.body[0].empId, 'EMP-LOC');
  assert.equal(responses.body[0].lat, 12.9716);

  const read = await request(app)
    .put(`/api/driver/trips/location-responses/${requested.body.id}/read`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({});
  assert.equal(read.status, 200);

  const afterRead = await request(app)
    .get('/api/driver/trips/location-responses')
    .set('Authorization', `Bearer ${driverToken}`);
  assert.deepEqual(afterRead.body, []);

  const tripHistory = await request(app)
    .get(`/api/driver/trips/location-responses?tripId=${encodeURIComponent(created.body.id)}`)
    .set('Authorization', `Bearer ${driverToken}`);
  assert.equal(tripHistory.status, 200);
  assert.equal(tripHistory.body[0].requestId, requested.body.id);
});
