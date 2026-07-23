import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeEmployee, makeAdmin, tokenFor } from './helpers.js';
import { EmployeeDocument } from '../src/models/EmployeeDocument.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function adminToken() {
  const admin = await makeAdmin('admin');
  return tokenFor(admin._id.toString(), 'admin');
}

// M-6: document fetch/delete looked docs up by docId alone, ignoring the
// employee (:id) in the path. Requests must be scoped to the owning employee,
// and a malformed docId must 404 (not crash with a 500).

test('fetches a document scoped to its owning employee', async () => {
  const token = await adminToken();
  const emp = await makeEmployee();
  const doc = await EmployeeDocument.create({
    employeeId: emp._id, name: 'kyc.png', mimeType: 'image/png', base64: 'AAAA',
  });

  const res = await request(app)
    .get(`/api/employees/${emp.empId}/documents/${doc._id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.base64, 'AAAA');
});

test('does not return a document under a different employee id (404)', async () => {
  const token = await adminToken();
  const owner = await makeEmployee();
  const other = await makeEmployee();
  const doc = await EmployeeDocument.create({
    employeeId: owner._id, name: 'kyc.png', mimeType: 'image/png', base64: 'SECRET',
  });

  const res = await request(app)
    .get(`/api/employees/${other.empId}/documents/${doc._id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 404);
});

test('a malformed document id returns 404, not 500', async () => {
  const token = await adminToken();
  const emp = await makeEmployee();

  const res = await request(app)
    .get(`/api/employees/${emp.empId}/documents/not-an-object-id`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 404);
});

test('does not delete a document under a different employee id', async () => {
  const token = await adminToken();
  const owner = await makeEmployee();
  const other = await makeEmployee();
  const doc = await EmployeeDocument.create({
    employeeId: owner._id, name: 'kyc.png', mimeType: 'image/png', base64: 'SECRET',
  });

  const res = await request(app)
    .delete(`/api/employees/${other.empId}/documents/${doc._id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 404);
  assert.equal(await EmployeeDocument.countDocuments({ _id: doc._id }), 1);
});

test('upload rejects content whose signature does not match the declared type', async () => {
  const token = await adminToken();
  const emp = await makeEmployee();
  const res = await request(app)
    .post(`/api/employees/${emp.empId}/documents`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'fake.png', mimeType: 'image/png', base64: Buffer.from('not a png').toString('base64') });
  assert.equal(res.status, 415);
});

test('upload accepts a small file with a matching signature', async () => {
  const token = await adminToken();
  const emp = await makeEmployee();
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const res = await request(app)
    .post(`/api/employees/${emp.empId}/documents`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'valid.png', mimeType: 'image/png', base64: pngHeader });
  assert.equal(res.status, 201);
});
