import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeAdmin, tokenFor } from './helpers.js';
import { Route } from '../src/models/Route.js';
import { Employee } from '../src/models/Employee.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function adminToken(): Promise<string> {
  const admin = await makeAdmin('admin');
  return tokenFor(admin._id.toString(), 'admin');
}

async function makeCorridorRoutes(): Promise<void> {
  await Route.create({
    routeId: 1,
    name: 'Hoskote',
    type: 'Both',
    geometryStatus: 'ready',
    dropPath: [{ lat: 12.97, lng: 77.59 }, { lat: 13.0201, lng: 77.7001 }, { lat: 13.15, lng: 77.90 }],
    pickupPath: [{ lat: 13.15, lng: 77.90 }, { lat: 13.0201, lng: 77.7001 }, { lat: 12.97, lng: 77.59 }],
  });
  await Route.create({
    routeId: 2,
    name: 'Other Route',
    type: 'Both',
    geometryStatus: 'ready',
    dropPath: [{ lat: 12.97, lng: 77.59 }, { lat: 12.98, lng: 77.72 }, { lat: 13.03, lng: 77.75 }],
    pickupPath: [{ lat: 13.03, lng: 77.75 }, { lat: 12.98, lng: 77.72 }, { lat: 12.97, lng: 77.59 }],
  });
}

test('employee without a manual route is assigned by nearest road corridor', async () => {
  await makeCorridorRoutes();
  const token = await adminToken();
  const response = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({
      id: 'EMP-CORRIDOR', name: 'Corridor Employee', contact: '9000011001',
      transportType: 'Office Transport', address: 'Near Hoskote road', latLong: '13.0200,77.7000', route: '',
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.route, 'Hoskote');
});

test('manual route selection is preserved but must reference a real route', async () => {
  await makeCorridorRoutes();
  const token = await adminToken();
  const selected = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({
      id: 'EMP-MANUAL', name: 'Manual Employee', contact: '9000011002',
      transportType: 'Office Transport', address: 'Near Hoskote road', latLong: '13.0200,77.7000', route: 'Other Route',
    });
  assert.equal(selected.status, 201);
  assert.equal((await Employee.findOne({ empId: 'EMP-MANUAL' }).lean())?.route, 'Other Route');

  const invalid = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ id: 'EMP-BAD-ROUTE', name: 'Bad', contact: '9000011003', latLong: '13.0200,77.7000', route: 'Missing Route' });
  assert.equal(invalid.status, 422);
});

test('office transport employee cannot save missing or invalid coordinates', async () => {
  const token = await adminToken();
  const missing = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ id: 'EMP-NO-GPS', name: 'No GPS', contact: '9000011004', transportType: 'Office Transport' });
  assert.equal(missing.status, 422);

  const invalid = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ id: 'EMP-BAD-GPS', name: 'Bad GPS', contact: '9000011005', latLong: '190,400' });
  assert.equal(invalid.status, 422);
});
