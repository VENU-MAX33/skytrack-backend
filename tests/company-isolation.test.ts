import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, clearDb, startTestDb, stopTestDb } from './helpers.js';
import { Company } from '../src/models/Company.js';
import { Employee } from '../src/models/Employee.js';
import { User } from '../src/models/User.js';
import { signToken } from '../src/middleware/auth.js';
import { Driver } from '../src/models/Driver.js';
import { OTP } from '../src/models/OTP.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

test('company administrators only list records owned by their company', async () => {
  const companyA = await Company.findOne({ code: 'TEST' });
  const companyB = await Company.create({ code: 'COMPB', name: 'Company B', status: 'active' });
  assert.ok(companyA);

  const [adminA, adminB] = await Promise.all([
    User.create({ email: 'admin-a@test.com', passwordHash: await bcrypt.hash('password', 4), name: 'Admin A', role: 'admin', active: true, companyId: companyA._id }),
    User.create({ email: 'admin-b@test.com', passwordHash: await bcrypt.hash('password', 4), name: 'Admin B', role: 'admin', active: true, companyId: companyB._id }),
  ]);
  await Employee.create([
    { companyId: companyA._id, empId: 'A-001', name: 'Company A Employee', contact: '9000000001' },
    { companyId: companyB._id, empId: 'B-001', name: 'Company B Employee', contact: '9000000002' },
  ]);

  const tokenA = signToken({ sub: adminA._id.toString(), role: 'admin', companyId: companyA._id.toString() });
  const tokenB = signToken({ sub: adminB._id.toString(), role: 'admin', companyId: companyB._id.toString() });
  const [responseA, responseB] = await Promise.all([
    request(app).get('/api/employees').set('Authorization', `Bearer ${tokenA}`),
    request(app).get('/api/employees').set('Authorization', `Bearer ${tokenB}`),
  ]);

  assert.equal(responseA.status, 200);
  assert.equal(responseB.status, 200);
  assert.deepEqual(responseA.body.map((employee: { id: string }) => employee.id), ['A-001']);
  assert.deepEqual(responseB.body.map((employee: { id: string }) => employee.id), ['B-001']);
});

test('a company token cannot update another company employee by id', async () => {
  const companyA = await Company.findOne({ code: 'TEST' });
  const companyB = await Company.create({ code: 'COMPB', name: 'Company B', status: 'active' });
  assert.ok(companyA);
  const adminB = await User.create({ email: 'admin-b@test.com', passwordHash: 'hash', name: 'Admin B', role: 'admin', active: true, companyId: companyB._id });
  const employeeA = await Employee.create({ companyId: companyA._id, empId: 'A-001', name: 'Company A Employee', contact: '9000000001' });
  const tokenB = signToken({ sub: adminB._id.toString(), role: 'admin', companyId: companyB._id.toString() });

  const response = await request(app)
    .put(`/api/employees/${employeeA.empId}`)
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ name: 'Hacked Name' });
  assert.equal(response.status, 404);
  const unchanged = await Employee.collection.findOne({ _id: employeeA._id });
  assert.equal(unchanged?.name, 'Company A Employee');
});

test('company admins can attach the same driver phone once per company without cross-company disclosure', async () => {
  const companyA = await Company.findOne({ code: 'TEST' });
  const companyB = await Company.create({ code: 'COMPB', name: 'Company B', status: 'active' });
  assert.ok(companyA);
  const [adminA, adminB] = await Promise.all([
    User.create({ email: 'driver-admin-a@test.com', passwordHash: 'hash', name: 'Admin A', role: 'admin', active: true, companyId: companyA._id }),
    User.create({ email: 'driver-admin-b@test.com', passwordHash: 'hash', name: 'Admin B', role: 'admin', active: true, companyId: companyB._id }),
  ]);
  const tokenA = signToken({ sub: adminA._id.toString(), role: 'admin', companyId: companyA._id.toString() });
  const tokenB = signToken({ sub: adminB._id.toString(), role: 'admin', companyId: companyB._id.toString() });
  const body = { name: 'Shared Driver', contact: '9876500000', dlNumber: 'DL-SHARED-A', active: 'Yes' };

  const first = await request(app).post('/api/drivers').set('Authorization', `Bearer ${tokenA}`).send(body);
  const second = await request(app).post('/api/drivers').set('Authorization', `Bearer ${tokenB}`).send({ ...body, dlNumber: 'DL-SHARED-B' });
  const duplicateA = await request(app).post('/api/drivers').set('Authorization', `Bearer ${tokenA}`).send({ ...body, dlNumber: 'DL-SHARED-A2' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(duplicateA.status, 409);
  assert.doesNotMatch(String(second.body.error ?? ''), /Company A|TEST/);
});

test('driver phone-only login discovers the owning company automatically', async () => {
  const companyB = await Company.create({ code: 'COMPB', name: 'Company B', status: 'active' });
  await Driver.create({ companyId: companyB._id, name: 'Company B Driver', dlNumber: 'DL-B-1', contact: '+91 98765 43210', active: 'Yes' });

  const response = await request(app).post('/api/driver/request-otp').send({ phone: '9876543210' });
  assert.equal(response.status, 200);
  const otp = await OTP.collection.findOne({ phone: '+91 98765 43210' });
  assert.equal(String(otp?.companyId), companyB._id.toString());
});

test('verified driver can select one of multiple company memberships', async () => {
  const companyA = await Company.findOne({ code: 'TEST' });
  const companyB = await Company.create({ code: 'COMPB', name: 'Company B', status: 'active' });
  assert.ok(companyA);
  await Driver.create([
    { companyId: companyA._id, name: 'Driver A', dlNumber: 'DL-A-1', contact: '9876543210', active: 'Yes' },
    { companyId: companyB._id, name: 'Driver B', dlNumber: 'DL-B-1', contact: '+91 98765 43210', active: 'Yes' },
  ]);

  const response = await request(app).post('/api/driver/request-otp').send({ phone: '9876543210' });
  assert.equal(response.status, 200);
  const otp = await OTP.collection.findOne({ phone: '9876543210' });
  assert.ok(otp);
  await OTP.collection.updateOne({ _id: otp._id }, { $set: { otpHash: await bcrypt.hash('123456', 4) } });

  const verified = await request(app)
    .post('/api/driver/verify-otp')
    .send({ phone: '9876543210', code: '123456' });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.companies.length, 2);

  const selected = await request(app)
    .post('/api/driver/select-company')
    .send({ selectionToken: verified.body.selectionToken, companyId: companyB._id.toString() });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.user.company.code, 'COMPB');
  assert.ok(selected.body.token);
});
