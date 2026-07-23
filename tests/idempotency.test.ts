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

async function seedTripPrereqs() {
  const admin = await makeAdmin('admin');
  const driver = await makeDriver();
  const route = await Route.create({ routeId: 1, name: 'Whitefield', type: 'Both' });
  const vehicle = await Vehicle.create({ rtoNo: 'KA01AB1234', vendor: 'Acme', driverId: driver._id, active: 'Yes' });
  await makeEmployee({ route: route.name, active: 'Yes' });
  return { token: tokenFor(admin._id.toString(), 'admin'), vehicle };
}

// M-3: a retried POST (same Idempotency-Key) must not create a second record.

test('replayed trip creation with the same Idempotency-Key creates one trip', async () => {
  const { token, vehicle } = await seedTripPrereqs();
  const send = () =>
    request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'abc-123')
      .send({ type: 'PickUp', vehicleNo: vehicle.rtoNo });

  const first = await send();
  const second = await send();

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.id, first.body.id, 'replay must return the original trip');
  assert.equal(await Trip.countDocuments({}), 1, 'only one trip should exist');
});

test('different Idempotency-Keys create distinct trips', async () => {
  const { token, vehicle } = await seedTripPrereqs();
  const send = (key: string) =>
    request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ type: 'PickUp', vehicleNo: vehicle.rtoNo });

  await send('key-1');
  await send('key-2');
  assert.equal(await Trip.countDocuments({}), 2);
});

test('trip creation without a key is unaffected', async () => {
  const { token, vehicle } = await seedTripPrereqs();
  const res = await request(app)
    .post('/api/trips')
    .set('Authorization', `Bearer ${token}`)
    .send({ type: 'PickUp', vehicleNo: vehicle.rtoNo });
  assert.equal(res.status, 201);
});

test('an Idempotency-Key cannot be reused with a different request body', async () => {
  const { token, vehicle } = await seedTripPrereqs();
  const first = await request(app).post('/api/trips')
    .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'body-bound')
    .send({ type: 'PickUp', vehicleNo: vehicle.rtoNo });
  const second = await request(app).post('/api/trips')
    .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'body-bound')
    .send({ type: 'Drop', vehicleNo: vehicle.rtoNo });
  assert.equal(first.status, 201);
  assert.equal(second.status, 422);
  assert.equal(await Trip.countDocuments({}), 1);
});
