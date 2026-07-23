import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee, makeAdmin, tokenFor } from './helpers.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';
import { Trip } from '../src/models/Trip.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function setupTrip() {
  const admin = await makeAdmin('admin');
  const token = tokenFor(admin._id.toString(), 'admin');
  const driver = await makeDriver();
  await Route.create({ routeId: 1, name: 'Whitefield', type: 'Both' });
  await Vehicle.create({ rtoNo: 'KA01AB1111', vendor: 'Acme', driverId: driver._id, active: 'Yes' });
  const emp = await makeEmployee({ route: 'Whitefield', active: 'Yes' });
  const create = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`)
    .send({ type: 'PickUp', vehicleNo: 'KA01AB1111', routeName: 'Whitefield', employeeIds: [emp.empId] });
  return { token, tripId: create.body.id as string, empId: emp._id.toString() };
}

test('trip DTO exposes escortName defaulting to empty', async () => {
  const { token, tripId } = await setupTrip();
  const res = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const trip = res.body.find((t: { id: string }) => t.id === tripId);
  assert.equal(trip.escort, 'No');
  assert.equal(trip.escortName, '');
});

test('admin sets escort Yes + name on a trip', async () => {
  const { token, tripId } = await setupTrip();
  const res = await request(app)
    .put(`/api/trips/${encodeURIComponent(tripId)}/escort`)
    .set('Authorization', `Bearer ${token}`)
    .send({ escort: 'Yes', escortName: 'Ravi Kumar' });
  assert.equal(res.status, 200);
  assert.equal(res.body.escort, 'Yes');
  assert.equal(res.body.escortName, 'Ravi Kumar');
});

test('escort=No clears the escort name', async () => {
  const { token, tripId } = await setupTrip();
  await request(app).put(`/api/trips/${encodeURIComponent(tripId)}/escort`)
    .set('Authorization', `Bearer ${token}`).send({ escort: 'Yes', escortName: 'Ravi' });
  const res = await request(app).put(`/api/trips/${encodeURIComponent(tripId)}/escort`)
    .set('Authorization', `Bearer ${token}`).send({ escort: 'No' });
  assert.equal(res.body.escort, 'No');
  assert.equal(res.body.escortName, '');
});

test('rejects an invalid escort value', async () => {
  const { token, tripId } = await setupTrip();
  const res = await request(app).put(`/api/trips/${encodeURIComponent(tripId)}/escort`)
    .set('Authorization', `Bearer ${token}`).send({ escort: 'Maybe' });
  assert.equal(res.status, 400);
});

async function setupEmployeeOnTrip() {
  const admin = await makeAdmin('admin');
  const adminToken = tokenFor(admin._id.toString(), 'admin');
  const driver = await makeDriver();
  await Route.create({ routeId: 1, name: 'Whitefield', type: 'Both' });
  await Vehicle.create({ rtoNo: 'KA01AB1111', vendor: 'Acme', driverId: driver._id, active: 'Yes' });
  const emp = await makeEmployee({ route: 'Whitefield', active: 'Yes' });
  const create = await request(app).post('/api/trips').set('Authorization', `Bearer ${adminToken}`)
    .send({ type: 'PickUp', vehicleNo: 'KA01AB1111', routeName: 'Whitefield', employeeIds: [emp.empId] });
  const empToken = tokenFor(emp._id.toString(), 'employee');
  return { adminToken, empToken, tripId: create.body.id as string };
}

test('employee report creates a record AND updates the trip', async () => {
  const { adminToken, empToken, tripId } = await setupEmployeeOnTrip();
  const res = await request(app).post('/api/escort-report')
    .set('Authorization', `Bearer ${empToken}`)
    .send({ tripId, present: 'Yes', escortName: 'Sita' });
  assert.equal(res.status, 201);
  assert.equal(res.body.present, 'Yes');
  assert.equal(res.body.escortName, 'Sita');

  const updated = await Trip.findOne({ tripId });
  assert.equal(updated!.escort, 'Yes');
  assert.equal(updated!.escortName, 'Sita');

  const list = await request(app).get('/api/escort-report').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
});

test('admin acknowledges an escort report', async () => {
  const { adminToken, empToken, tripId } = await setupEmployeeOnTrip();
  const created = await request(app).post('/api/escort-report')
    .set('Authorization', `Bearer ${empToken}`).send({ tripId, present: 'No' });
  const ack = await request(app).put(`/api/escort-report/${created.body.id}/acknowledge`)
    .set('Authorization', `Bearer ${adminToken}`).send({});
  assert.equal(ack.status, 200);
  assert.equal(ack.body.status, 'acknowledged');
});

test('employee role cannot list escort reports', async () => {
  const { empToken } = await setupEmployeeOnTrip();
  const res = await request(app).get('/api/escort-report').set('Authorization', `Bearer ${empToken}`);
  assert.equal(res.status, 403);
});
