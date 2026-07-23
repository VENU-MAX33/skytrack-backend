// Dev launcher: boots a local MongoDB data directory (no local mongod required),
// starts the real API server against it, and can seed demo data when explicitly
// requested. The data directory persists across server restarts.
// Run with:  node --import tsx run-local.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env') });
const dbPath = path.join(backendDir, '.local-mongodb');
await mkdir(dbPath, { recursive: true });
const mongod = await MongoMemoryServer.create({ instance: { dbPath } });
process.env.MONGODB_URI = mongod.getUri() + 'monitorx';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-me';
// `config/env.ts` loads backend/.env and defaults to `dev` when no provider is
// configured. Do not set SMS_PROVIDER here: doing so would prevent dotenv from
// reading SMS_PROVIDER=fast2sms from backend/.env and silently log OTPs instead
// of delivering them.
process.env.PORT = process.env.PORT || '5000';
console.log('[run-local] persistent local MongoDB:', process.env.MONGODB_URI);
console.log('[run-local] data directory:', dbPath);

// Import after env is set so config/env validation sees the right values.
await import('./src/server.ts');

// Wait for the server's mongoose connection, then create the local admin login.
await new Promise((resolve) => {
  if (mongoose.connection.readyState === 1) return resolve();
  mongoose.connection.once('connected', resolve);
});
const { User } = await import('./src/models/User.ts');

// Set SEED_DEMO_DATA=true only when a disposable full demo dataset is needed.
if (process.env.SEED_DEMO_DATA === 'true') {
  if (!(await User.findOne({ role: { $in: ['platform-owner', 'admin'] } }))) {
    console.log('[run-local] Database empty. Running full seed...');
    const { seed } = await import('./src/seed/seed.ts');
    await seed(false);
    console.log('[run-local] Database successfully seeded!');
  }
} else if (!(await User.findOne({ role: { $in: ['platform-owner', 'admin'] } }))) {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64url');
  await User.create({
    email: 'admin@skytrack.com',
    passwordHash: await bcrypt.hash(adminPassword, 10),
    name: 'Admin',
    role: 'admin',
  });
  console.log(`[run-local] seeded admin@skytrack.com / ${adminPassword}`);
}
