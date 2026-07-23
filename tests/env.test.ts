import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionConfig, assertSmsProviderSafe, isCorsOriginAllowed } from '../src/config/env.js';

// Follow-up to C-2: production must not silently run in 'dev' SMS mode, which
// sends no SMS at all (and previously leaked the code). Fail closed instead.

test('rejects dev SMS mode in production', () => {
  assert.throws(() => assertSmsProviderSafe('production', 'dev'), /SMS_PROVIDER/);
});

test('allows a real provider in production', () => {
  assert.doesNotThrow(() => assertSmsProviderSafe('production', 'fast2sms'));
  assert.doesNotThrow(() => assertSmsProviderSafe('production', 'msg91'));
});

test('allows dev SMS mode outside production', () => {
  assert.doesNotThrow(() => assertSmsProviderSafe(undefined, 'dev'));
  assert.doesNotThrow(() => assertSmsProviderSafe('development', 'dev'));
});

test('allows any localhost Vite port during development but not production', () => {
  const previous = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    assert.equal(isCorsOriginAllowed('http://localhost:5176'), true);
    assert.equal(isCorsOriginAllowed('http://127.0.0.1:5189'), true);

    process.env.NODE_ENV = 'production';
    assert.equal(isCorsOriginAllowed('http://localhost:5176'), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('production configuration rejects weak secrets and non-HTTPS origins', () => {
  const base = { nodeEnv: 'production', jwtSecret: 'a'.repeat(40), corsOrigins: ['https://admin.example.com'], smsProvider: 'fast2sms', fast2smsApiKey: 'key' };
  assert.doesNotThrow(() => assertProductionConfig(base));
  assert.throws(() => assertProductionConfig({ ...base, jwtSecret: 'change-me' }), /JWT_SECRET/);
  assert.throws(() => assertProductionConfig({ ...base, corsOrigins: ['http://admin.example.com'] }), /HTTPS/);
  assert.throws(() => assertProductionConfig({ ...base, fast2smsApiKey: '' }), /FAST2SMS_API_KEY/);
});
