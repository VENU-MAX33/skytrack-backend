import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee, makeAdmin, tokenFor } from './helpers.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

// M-4: trip search now runs in the DB rather than an in-memory scan. These
// characterise the search so the behaviour is preserved.

async function setup() {
  const admin = await makeAdmin('admin');
  const token = tokenFor(admin._id.toString(), 'admin');
  const driver = await makeDriver();
  await Route.create({ routeId: 1, name: 'Whitefield', type: 'Both' });
  await Route.create({ routeId: 2, name: 'Koramangala', type: 'Both' });
  await Vehicle.create({ rtoNo: 'KA01AB1111', vendor: 'Acme', driverId: driver._id, active: 'Yes' });
  await Vehicle.create({ rtoNo: 'KA02XY2222', vendor: 'Globex', driverId: driver._id, active: 'Yes' });
  await makeEmployee({ route: 'Whitefield', active: 'Yes' });
  await makeEmployee({ route: 'Koramangala', active: 'Yes' });

  const create = (vehicleNo: string, routeName: string) =>
    request(app).post('/api/trips').set('Authorization', `Bearer ${token}`)
      .send({ type: 'PickUp', vehicleNo, routeName });
  await create('KA01AB1111', 'Whitefield');
  await create('KA02XY2222', 'Koramangala');
  return token;
}

test('search matches by vendor', async () => {
  const token = await setup();
  const res = await request(app).get('/api/trips?search=globex').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].vendor, 'Globex');
});

test('search matches by vehicle number (populated field)', async () => {
  const token = await setup();
  const res = await request(app).get('/api/trips?search=KA01AB').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].vehicleNo, 'KA01AB1111');
});

test('search matches by route/location', async () => {
  const token = await setup();
  const res = await request(app).get('/api/trips?search=whitefield').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
});

test('empty search returns all trips', async () => {
  const token = await setup();
  const res = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
  assert.equal(res.body.length, 2);
});
