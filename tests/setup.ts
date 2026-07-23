// Keep the test command deterministic across shells and developer machines.
// This file is loaded before application modules, so dotenv cannot replace
// these values with a developer's local .env settings.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1/test';
process.env.JWT_SECRET ??= 'test-secret';
process.env.SMS_PROVIDER ??= 'dev';
process.env.CORS_ORIGINS ??= [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
].join(',');
