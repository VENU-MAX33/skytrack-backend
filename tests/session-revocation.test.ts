import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeDriver, makeEmployee, makeAdmin, tokenFor } from './helpers.js';
import { Driver } from '../src/models/Driver.js';
import { Employee } from '../src/models/Employee.js';
import { User } from '../src/models/User.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

// H-3: tokens live for 30 days and cannot be revoked. Deactivating or deleting
// an account must take effect immediately — the middleware re-checks the
// principal on every authenticated request rather than trusting the token alone.

test('an active driver token reaches a driver endpoint (200)', async () => {
  const driver = await makeDriver();
  const res = await request(app)
    .get('/api/driver/trips')
    .set('Authorization', `Bearer ${tokenFor(driver._id.toString(), 'driver')}`);
  assert.equal(res.status, 200);
});

test('a deactivated driver token is rejected (401)', async () => {
  const driver = await makeDriver();
  const token = tokenFor(driver._id.toString(), 'driver');
  await Driver.updateOne({ _id: driver._id }, { active: 'No' });

  const res = await request(app).get('/api/driver/trips').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
});

test('a deactivated employee token is rejected (401)', async () => {
  const emp = await makeEmployee();
  const token = tokenFor(emp._id.toString(), 'employee');
  await Employee.updateOne({ _id: emp._id }, { active: 'No' });

  const res = await request(app).get('/api/employee/trips').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
});

test('a deleted employee token is rejected (401)', async () => {
  const emp = await makeEmployee();
  const token = tokenFor(emp._id.toString(), 'employee');
  await Employee.deleteOne({ _id: emp._id });

  const res = await request(app).get('/api/employee/trips').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
});

test('a deleted admin token is rejected on a back-office endpoint (401)', async () => {
  const admin = await makeAdmin('admin');
  const token = tokenFor(admin._id.toString(), 'admin');
  await User.deleteOne({ _id: admin._id });

  const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
});
