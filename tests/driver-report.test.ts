import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, makeDriver, makeEmployee, startTestDb, stopTestDb, tokenFor } from './helpers.js';
import { Route } from '../src/models/Route.js';
import { Trip } from '../src/models/Trip.js';
import { Vehicle } from '../src/models/Vehicle.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('driver report returns private daily, monthly and yearly completed counts', async () => {
  const driver = await makeDriver({ contact: '9845000011' });
  const otherDriver = await makeDriver({ contact: '9845000022' });
  const employee = await makeEmployee({ empId: 'EMP-REPORT' });
  const route = await Route.create({ routeId: 901, name: 'Report Route', type: 'Both' });
  const vehicle = await Vehicle.create({ rtoNo: 'KA01RP1001', driverId: driver._id, active: 'Yes' });

  async function trip(tripId: string, date: string, owner = driver._id, status = 'Completed') {
    return Trip.create({
      tripId, date, status, type: 'PickUp', shiftTime: '09:00', frozen: true,
      vehicleId: vehicle._id, driverId: owner, routeId: route._id,
      employeeIds: [employee._id], completedAt: new Date(`${date}T05:00:00Z`),
    });
  }

  await Promise.all([
    trip('TRP-RPT-001', '2026-07-16'),
    trip('TRP-RPT-002', '2026-07-16', driver._id, 'Completed Late'),
    trip('TRP-RPT-003', '2026-07-10'),
    trip('TRP-RPT-004', '2026-03-01'),
    trip('TRP-RPT-PRIVATE', '2026-07-16', otherDriver._id),
  ]);

  const response = await request(app)
    .get('/api/driver/trips/report?date=2026-07-16')
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.dailyCompleted, 2);
  assert.equal(response.body.monthlyCompleted, 3);
  assert.equal(response.body.yearlyCompleted, 4);
  assert.equal(response.body.total, 2);
  assert.deepEqual(response.body.trips.map((item: { id: string }) => item.id).sort(), ['TRP-RPT-001', 'TRP-RPT-002']);
});

test('driver report rejects an invalid date', async () => {
  const driver = await makeDriver();
  const response = await request(app)
    .get('/api/driver/trips/report?date=not-a-date')
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);
  assert.equal(response.status, 400);
});
