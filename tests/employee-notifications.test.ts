import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, makeEmployee, startTestDb, stopTestDb, tokenFor } from './helpers.js';
import { EmployeeNotification } from '../src/models/EmployeeNotification.js';
import { PushDevice } from '../src/models/PushDevice.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('employee registers a device token and can unregister it', async () => {
  const employee = await makeEmployee();
  const token = tokenFor(employee._id.toString(), 'employee');
  const deviceToken = `test-fcm-token-${'x'.repeat(80)}`;

  const registered = await request(app)
    .post('/api/employee/notifications/push/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: deviceToken });
  assert.equal(registered.status, 200);
  assert.equal((await PushDevice.findOne({ token: deviceToken }))?.active, true);

  const unregistered = await request(app)
    .put('/api/employee/notifications/push/unregister')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: deviceToken });
  assert.equal(unregistered.status, 200);
  assert.equal((await PushDevice.findOne({ token: deviceToken }))?.active, false);
});

test('employee notification inbox is private and supports read state', async () => {
  const employee = await makeEmployee();
  const otherEmployee = await makeEmployee({ contact: '9886000002' });
  const token = tokenFor(employee._id.toString(), 'employee');
  const own = await EmployeeNotification.create({
    employeeId: employee._id,
    type: 'trip-approved',
    title: 'Trip request approved',
    body: 'pickup trip approved',
    link: '/trip/TRP-1',
  });
  await EmployeeNotification.create({
    employeeId: otherEmployee._id,
    type: 'trip-rejected',
    title: 'Trip request rejected',
    body: 'private rejection reason',
  });

  const inbox = await request(app)
    .get('/api/employee/notifications')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.unread, 1);
  assert.equal(inbox.body.items.length, 1);
  assert.equal(inbox.body.items[0].id, own._id.toString());

  const read = await request(app)
    .put(`/api/employee/notifications/${own._id}/read`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(read.status, 200);
  assert.equal(read.body.read, true);
});
