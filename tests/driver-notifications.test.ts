import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, makeDriver, makeEmployee, startTestDb, stopTestDb, tokenFor } from './helpers.js';
import { DriverPushDevice } from '../src/models/DriverPushDevice.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('driver registers a device token and can unregister it', async () => {
  const driver = await makeDriver();
  const token = tokenFor(driver._id.toString(), 'driver');
  const deviceToken = `test-driver-fcm-token-${'x'.repeat(80)}`;

  const registered = await request(app)
    .post('/api/driver/notifications/push/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: deviceToken });
  assert.equal(registered.status, 200);
  const device = await DriverPushDevice.findOne({ token: deviceToken });
  assert.equal(device?.active, true);
  assert.equal(device?.driverId.toString(), driver._id.toString());

  const unregistered = await request(app)
    .put('/api/driver/notifications/push/unregister')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: deviceToken });
  assert.equal(unregistered.status, 200);
  assert.equal((await DriverPushDevice.findOne({ token: deviceToken }))?.active, false);
});

test('employee tokens cannot access driver push registration', async () => {
  const employee = await makeEmployee();
  const response = await request(app)
    .post('/api/driver/notifications/push/register')
    .set('Authorization', `Bearer ${tokenFor(employee._id.toString(), 'employee')}`)
    .send({ token: `test-fcm-token-${'x'.repeat(80)}` });
  assert.equal(response.status, 403);
});
