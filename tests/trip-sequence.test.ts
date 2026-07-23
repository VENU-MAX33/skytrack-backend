import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee, makeAdmin, tokenFor } from './helpers.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { Route } from '../src/models/Route.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function seedTripPrereqs() {
  const admin = await makeAdmin('admin');
  const driver = await makeDriver();
  const route = await Route.create({ routeId: 1, name: 'Whitefield', type: 'Both' });
  const vehicle = await Vehicle.create({
    rtoNo: 'KA01AB1234', vendor: 'Acme', driverId: driver._id, active: 'Yes',
  });
  await makeEmployee({ route: route.name, active: 'Yes' });
  return { token: tokenFor(admin._id.toString(), 'admin'), vehicle };
}

// M-2: tripId was "max existing seq + 1" (read-then-write), so concurrent
// creates computed the same id and collided on the unique index. Creation must
// hand out distinct ids under concurrency.

test('concurrent trip creation produces distinct ids with no collisions', async () => {
  const { token, vehicle } = await seedTripPrereqs();

  const create = () =>
    request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'PickUp', vehicleNo: vehicle.rtoNo });

  const results = await Promise.all(Array.from({ length: 6 }, create));

  for (const res of results) {
    assert.equal(res.status, 201, `expected 201, got ${res.status} (${JSON.stringify(res.body)})`);
  }
  const ids = results.map((r) => r.body.id);
  assert.equal(new Set(ids).size, ids.length, `ids must be unique, got ${ids.join(', ')}`);
});
