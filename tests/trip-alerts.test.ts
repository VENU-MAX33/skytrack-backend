import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, makeDriver, makeEmployee, startTestDb, stopTestDb, tokenFor } from './helpers.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';
import { Trip } from '../src/models/Trip.js';
import { Notification } from '../src/models/Notification.js';
import { SosConfig } from '../src/models/SosConfig.js';
import { processTripAlerts } from '../src/services/trip-alert.service.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function makeTrip(options: {
  startedAt?: Date;
  shiftTime?: string;
  date?: string;
  verified?: boolean;
} = {}) {
  const driver = await makeDriver();
  const employee = await makeEmployee({ name: 'Pending Employee', empId: 'EMP-PENDING' });
  const vehicle = await Vehicle.create({ rtoNo: `KA-${Math.random().toString(36).slice(2, 8)}`, driverId: driver._id });
  const route = await Route.create({ routeId: Math.floor(Math.random() * 1_000_000), name: `Route ${Math.random().toString(36).slice(2, 7)}` });
  const trip = await Trip.create({
    tripId: `TRIP-${Math.random().toString(36).slice(2, 9)}`,
    status: 'Trip Started',
    type: 'Drop',
    date: options.date ?? '2026-07-15',
    shiftTime: options.shiftTime ?? '18:00',
    vehicleId: vehicle._id,
    driverId: driver._id,
    routeId: route._id,
    employeeIds: [employee._id],
    frozen: true,
    startedAt: options.startedAt ?? new Date('2026-07-15T10:00:00.000Z'),
    verifiedEmployees: options.verified ? [employee._id] : [],
  });
  return { driver, employee, trip };
}

test('driver cannot complete a trip until every assigned employee OTP is verified', async () => {
  const { driver, trip } = await makeTrip();
  const res = await request(app)
    .put(`/api/driver/trips/${trip.tripId}/complete`)
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);

  assert.equal(res.status, 409);
  assert.match(res.body.error, /OTP verification is pending/);
  const unchanged = await Trip.findById(trip._id);
  assert.equal(unchanged?.status, 'Trip Started');
  assert.equal(unchanged?.completedAt, null);
});

test('overdue active trips create one admin notification without an OTP SMS when all OTPs are verified', async () => {
  const { trip } = await makeTrip({ shiftTime: '09:00', verified: true });
  const now = new Date('2026-07-15T04:00:00.000Z'); // 09:30 in India

  await processTripAlerts(now);
  await processTripAlerts(now);

  assert.equal(await Notification.countDocuments({ refId: trip.tripId }), 1);
  const updated = await Trip.findById(trip._id);
  assert.ok(updated?.overdueNotifiedAt);
  assert.equal(updated?.incompleteOtpSmsSentAt, null);
});

test('a frozen trip that was never started still creates an overdue admin notification', async () => {
  const { trip } = await makeTrip({ shiftTime: '09:00', verified: true });
  await Trip.updateOne({ _id: trip._id }, { $set: { status: 'Not Started Yet', startedAt: null } });

  await processTripAlerts(new Date('2026-07-15T04:00:00.000Z'));

  assert.equal(await Notification.countDocuments({ refId: trip.tripId }), 1);
});

test('unverified employee OTPs send one SOS-phone SMS escalation after 30 minutes', async () => {
  const { trip } = await makeTrip({
    shiftTime: '23:00',
    startedAt: new Date('2026-07-15T03:00:00.000Z'),
  });
  await SosConfig.create({ alertPhone: '9845012345' });
  const now = new Date('2026-07-15T03:31:00.000Z');

  await processTripAlerts(now);
  await processTripAlerts(now);

  const updated = await Trip.findById(trip._id);
  assert.ok(updated?.incompleteOtpSmsSentAt);
  assert.equal(await Notification.countDocuments({ refId: trip.tripId }), 0);
});

test('a fully OTP-verified trip completed after its allocated time is marked Completed Late', async () => {
  const { driver, trip } = await makeTrip({ date: '2020-01-01', shiftTime: '00:00', verified: true });
  const res = await request(app)
    .put(`/api/driver/trips/${trip.tripId}/complete`)
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'Completed Late');
});
