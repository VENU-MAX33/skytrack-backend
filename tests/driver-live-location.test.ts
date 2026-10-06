import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, makeDriver, makeEmployee, startTestDb, stopTestDb, tokenFor } from './helpers.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';
import { Trip } from '../src/models/Trip.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function liveTrip() {
  const driver = await makeDriver();
  const employee = await makeEmployee();
  const vehicle = await Vehicle.create({
    rtoNo: 'KA01LIVE01',
    driverId: driver._id,
    trackingKey: 'live-location-key',
  });
  const route = await Route.create({ routeId: 774411, name: 'Live Route' });
  const trip = await Trip.create({
    tripId: 'TRIP-LIVE-1',
    status: 'Trip Started',
    type: 'PickUp',
    date: '2099-10-06',
    shiftTime: '09:00',
    vehicleId: vehicle._id,
    driverId: driver._id,
    routeId: route._id,
    employeeIds: [employee._id],
    frozen: true,
    startedAt: new Date(),
  });
  return { driver, employee, vehicle, trip };
}

test('driver GPS ping is returned to an assigned employee as the latest location', async () => {
  const { driver, employee, vehicle } = await liveTrip();
  const ping = await request(app)
    .post('/api/driver/tracking/ping')
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`)
    .send({ key: vehicle.trackingKey, lat: 12.9841, lng: 77.6929, speed: 28 });

  assert.equal(ping.status, 200);
  const response = await request(app)
    .get('/api/employee/trips')
    .set('Authorization', `Bearer ${tokenFor(employee._id.toString(), 'employee')}`);

  assert.equal(response.status, 200);
  assert.equal(response.body[0].driverLocation.lat, 12.9841);
  assert.equal(response.body[0].driverLocation.lng, 77.6929);
  assert.equal(response.body[0].driverLocation.speed, 28);
  assert.ok(response.body[0].driverLocation.updatedAt);
});

test('employee trip has no driver location before the first GPS ping', async () => {
  const { employee } = await liveTrip();
  const response = await request(app)
    .get('/api/employee/trips')
    .set('Authorization', `Bearer ${tokenFor(employee._id.toString(), 'employee')}`);

  assert.equal(response.status, 200);
  assert.equal(response.body[0].driverLocation, null);
});

test('a stored vehicle position from before the trip started is not exposed', async () => {
  const { employee, vehicle, trip } = await liveTrip();
  const startedAt = new Date('2026-10-06T10:00:00.000Z');
  await Trip.updateOne({ _id: trip._id }, { $set: { startedAt } });
  await Vehicle.updateOne({ _id: vehicle._id }, {
    $set: { lat: 12.91, lng: 77.61, lastPingAt: new Date('2026-10-06T09:59:00.000Z') },
  });

  const response = await request(app)
    .get('/api/employee/trips')
    .set('Authorization', `Bearer ${tokenFor(employee._id.toString(), 'employee')}`);

  assert.equal(response.status, 200);
  assert.equal(response.body[0].driverLocation, null);
});
