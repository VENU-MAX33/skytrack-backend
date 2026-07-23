import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, startTestDb, stopTestDb, clearDb, makeAdmin, makeDriver, tokenFor } from './helpers.js';
import { Driver } from '../src/models/Driver.js';
import { Employee } from '../src/models/Employee.js';
import { Vehicle } from '../src/models/Vehicle.js';

before(startTestDb);
after(stopTestDb);
beforeEach(clearDb);

async function adminToken(): Promise<string> {
  const admin = await makeAdmin('admin');
  return tokenFor(admin._id.toString(), 'admin');
}

test('employee bulk import uses public id and inserts all valid rows', async () => {
  const token = await adminToken();
  const res = await request(app)
    .post('/api/employees/bulk')
    .set('Authorization', `Bearer ${token}`)
    .send({ employees: [
      { id: 'EMP-101', name: 'Asha', contact: '9000000001', shiftLogin: '09:00', transportType: 'Self Transport' },
      { id: 'EMP-102', name: 'Ben', contact: '9000000002', active: 'Yes', transportType: 'Self Transport' },
    ] });

  assert.equal(res.status, 201);
  assert.equal(res.body.created, 2);
  assert.deepEqual((await Employee.find().sort({ empId: 1 }).lean()).map((employee) => employee.empId), ['EMP-101', 'EMP-102']);
});

test('employee bulk import is all-or-nothing when any row is invalid', async () => {
  const token = await adminToken();
  const res = await request(app)
    .post('/api/employees/bulk')
    .set('Authorization', `Bearer ${token}`)
    .send({ employees: [
      { id: 'EMP-201', name: 'Valid', contact: '9000000011', transportType: 'Self Transport' },
      { id: 'EMP-202', name: '', contact: '9000000012', transportType: 'Self Transport' },
    ] });

  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].row, 3);
  assert.equal(await Employee.countDocuments(), 0);
});

test('driver bulk import rejects duplicates without partially inserting rows', async () => {
  const token = await adminToken();
  await makeDriver({ name: 'Existing', dlNumber: 'DL-EXISTING', contact: '9000000021' });
  const res = await request(app)
    .post('/api/drivers/bulk')
    .set('Authorization', `Bearer ${token}`)
    .send({ drivers: [
      { name: 'New Driver', dlNumber: 'DL-NEW', contact: '9000000022' },
      { name: 'Duplicate', dlNumber: 'DL-EXISTING', contact: '9000000023' },
    ] });

  assert.equal(res.status, 422);
  assert.equal(await Driver.countDocuments(), 1);
});

test('vehicle bulk import resolves the driver name and inserts valid rows', async () => {
  const token = await adminToken();
  const driver = await makeDriver({ name: 'Assigned Driver', contact: '9000000031' });
  const res = await request(app)
    .post('/api/vehicles/bulk')
    .set('Authorization', `Bearer ${token}`)
    .send({ vehicles: [
      { rtoNo: 'KA01AB1234', model: 'SEDAN', driver: 'Assigned Driver', active: 'Yes' },
    ] });

  assert.equal(res.status, 201);
  const vehicle = await Vehicle.findOne({ rtoNo: 'KA01AB1234' }).lean();
  assert.ok(vehicle);
  assert.equal(vehicle.driverId?.toString(), driver._id.toString());
});
