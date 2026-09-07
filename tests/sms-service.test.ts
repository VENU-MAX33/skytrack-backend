import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFast2SmsRequest, dltTextVariable, formatCompanySms } from '../src/services/sms.service.js';

test('DLT request uses the Message ID and ordered variables, never free text', () => {
  const body = buildFast2SmsRequest({
    mode: 'dlt', senderId: 'SKYTRK', templateId: 'MESSAGE123',
    variables: ['654321', 'TRIP-7'], number: '9845000111', deliveryId: 'DELIVERY-1',
    quickMessage: 'This text must not be sent in DLT mode',
  });

  assert.deepEqual(body, {
    route: 'dlt', sender_id: 'SKYTRK', message: 'MESSAGE123',
    variables_values: '654321|TRIP-7', numbers: '9845000111',
    sms_details: '1', udf1: 'DELIVERY-1',
  });
  assert.doesNotMatch(JSON.stringify(body), /This text must not be sent/);
});

test('temporary Quick mode is explicit and uses ASCII branding punctuation', () => {
  const message = formatCompanySms('SkyTrack', 'login-otp', 'Your OTP is 654321.');
  const body = buildFast2SmsRequest({
    mode: 'quick', senderId: '', templateId: '', variables: ['654321'],
    number: '9845000111', deliveryId: 'DELIVERY-2', quickMessage: message,
  });

  assert.equal(body.route, 'q');
  assert.equal(body.message, 'SkyTrack - Login OTP: Your OTP is 654321.');
  assert.doesNotMatch(body.message, /—/);
});

test('DLT text values are normalized, delimiter-safe, and capped at 40 characters', () => {
  const value = dltTextVariable(['EMP001', 'A very long | employee name that exceeds the allowed value']);
  assert.equal(value.length, 40);
  assert.doesNotMatch(value, /\|/);
  assert.equal(dltTextVariable([], 'NOT LINKED'), 'NOT LINKED');
});
