import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeAdmin, tokenFor } from './helpers.js';
import { Driver } from '../src/models/Driver.js';
import { Employee } from '../src/models/Employee.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function adminToken() {
  const admin = await makeAdmin('admin');
  return tokenFor(admin._id.toString(), 'admin');
}

// H-4: create/update spread the request body straight into the model, letting a
// caller set fields the API never intends to expose — notably the auth secret
// (passwordHash). These must be ignored.

test('POST /api/drivers ignores a client-supplied passwordHash', async () => {
  const token = await adminToken();
  const res = await request(app)
    .post('/api/drivers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Mallory', dlNumber: 'DL-EVIL-1', passwordHash: 'injected-hash' });

  assert.equal(res.status, 201);
  const doc = await Driver.findOne({ dlNumber: 'DL-EVIL-1' });
  assert.ok(doc);
  assert.notEqual(doc!.passwordHash, 'injected-hash');
});

test('PUT /api/drivers/:name ignores a client-supplied passwordHash', async () => {
  const token = await adminToken();
  await Driver.create({ name: 'Bob', dlNumber: 'DL-1', passwordHash: 'original' });

  const res = await request(app)
    .put('/api/drivers/Bob')
    .set('Authorization', `Bearer ${token}`)
    .send({ contact: '9845000000', passwordHash: 'injected-hash' });

  assert.equal(res.status, 200);
  const doc = await Driver.findOne({ name: 'Bob' });
  assert.equal(doc!.passwordHash, 'original');
  assert.equal(doc!.contact, '9845000000'); // legitimate field still applied
});

test('POST /api/employees ignores a client-supplied passwordHash', async () => {
  const token = await adminToken();
  const res = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ id: 'EMP-EVIL', name: 'Mallory', passwordHash: 'injected-hash' });

  assert.equal(res.status, 201);
  const doc = await Employee.findOne({ empId: 'EMP-EVIL' });
  assert.ok(doc);
  assert.notEqual(doc!.passwordHash, 'injected-hash');
});
