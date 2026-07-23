import http from 'http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { initSocket } from '../src/websocket/index.js';
import { signToken } from '../src/middleware/auth.js';
import { Driver } from '../src/models/Driver.js';
import { Employee } from '../src/models/Employee.js';
import { User } from '../src/models/User.js';
import { Company } from '../src/models/Company.js';
import { LEGACY_COMPANY_ID } from '../src/tenancy/model.js';

let mongod: MongoMemoryServer | null = null;
let httpServer: http.Server | null = null;

/** Boot an isolated in-memory MongoDB, connect mongoose, and init Socket.IO. */
export async function startTestDb(): Promise<void> {
  // Windows CI/dev machines can take longer than MongoMemoryServer's 10s
  // default to launch the first binary. Give startup enough room so a slow
  // process does not masquerade as an application test failure.
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongod.getUri());
  await Company.create({ _id: LEGACY_COMPANY_ID, code: 'TEST', name: 'Test Company', status: 'active' });
  // Init a Socket.IO server (not listening) so emit helpers used by routes work.
  if (!httpServer) {
    httpServer = http.createServer();
    initSocket(httpServer);
  }
}

/** Disconnect mongoose and shut the in-memory MongoDB down. */
export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  mongod = null;
}

/** Remove all documents from every collection so each test starts clean. */
export async function clearDb(): Promise<void> {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  await Company.create({ _id: LEGACY_COMPANY_ID, code: 'TEST', name: 'Test Company', status: 'active' });
}

export const app = createApp();

// ---- Fixtures -------------------------------------------------------------

export async function makeDriver(overrides: Record<string, unknown> = {}) {
  return Driver.create({
    name: 'Test Driver',
    dlNumber: `DL-${Math.random().toString(36).slice(2, 10)}`,
    contact: '9845000001',
    aadhaar: '1111-2222-3333',
    pan: 'ABCDE1234F',
    active: 'Yes',
    ...overrides,
  });
}

export async function makeEmployee(overrides: Record<string, unknown> = {}) {
  return Employee.create({
    empId: `EMP-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Employee',
    contact: '9886000001',
    active: 'Yes',
    ...overrides,
  });
}

export async function makeAdmin(role: 'admin' | 'staff' = 'admin') {
  const passwordHash = await bcrypt.hash('pw', 10);
  return User.create({
    email: `${role}-${Math.random().toString(36).slice(2, 8)}@monitorx.com`,
    passwordHash,
    name: role === 'admin' ? 'Admin' : 'Staff',
    role,
    companyId: LEGACY_COMPANY_ID,
    active: true,
  });
}

export function tokenFor(sub: string, role: 'admin' | 'staff' | 'driver' | 'employee'): string {
  return signToken({ sub, role, companyId: LEGACY_COMPANY_ID.toString() });
}
