import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee, makeAdmin, tokenFor } from './helpers.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

// Two employees share the same vehicle + shift time on one trip. The trip's
// employees must come back ordered by distance from the office so the driver
// (and Trip Management) get a sensible stop sequence.
async function setup() {
  const admin = await makeAdmin('admin');
  const token = tokenFor(admin._id.toString(), 'admin');
  const driver = await makeDriver();
  await Route.create({ routeId: 1, name: 'Whitefield', type: 'Both' });
  await Vehicle.create({ rtoNo: 'KA01AB1111', vendor: 'Acme', driverId: driver._id, active: 'Yes' });
  const far = await makeEmployee({ empId: 'EMP-FAR', name: 'Far', route: 'Whitefield', distance: '8' });
  const near = await makeEmployee({ empId: 'EMP-NEAR', name: 'Near', route: 'Whitefield', distance: '3' });
  return { token, far, near };
}

async function createTrip(token: string, type: 'PickUp' | 'Drop', empIds: string[]) {
  const res = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`)
    .send({ type, vehicleNo: 'KA01AB1111', routeName: 'Whitefield', shiftTime: '09:00', employeeIds: empIds });
  return res.body.id as string;
}

test('PickUp orders employees farthest-from-office first', async () => {
  const { token } = await setup();
  await createTrip(token, 'PickUp', ['EMP-NEAR', 'EMP-FAR']);
  const res = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
  const trip = res.body.find((t: { type: string }) => t.type === 'PickUp');
  assert.equal(trip.employees[0].id, 'EMP-FAR');
  assert.equal(trip.employees[1].id, 'EMP-NEAR');
});

test('Drop orders employees nearest-from-office first', async () => {
  const { token } = await setup();
  await createTrip(token, 'Drop', ['EMP-NEAR', 'EMP-FAR']);
  const res = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
  const trip = res.body.find((t: { type: string }) => t.type === 'Drop');
  assert.equal(trip.employees[0].id, 'EMP-NEAR');
  assert.equal(trip.employees[1].id, 'EMP-FAR');
});

test('employee with no distance sorts to the office-end on a PickUp', async () => {
  const { token } = await setup();
  await makeEmployee({ empId: 'EMP-BLANK', name: 'Blank', route: 'Whitefield', distance: '' });
  await createTrip(token, 'PickUp', ['EMP-NEAR', 'EMP-FAR', 'EMP-BLANK']);
  const res = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
  const trip = res.body.find((t: { type: string }) => t.type === 'PickUp');
  // Farthest first, nearest next, unknown-distance last (closest to office end).
  assert.deepEqual(trip.employees.map((e: { id: string }) => e.id), ['EMP-FAR', 'EMP-NEAR', 'EMP-BLANK']);
});
