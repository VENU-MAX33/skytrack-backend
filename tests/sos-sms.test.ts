import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSosSms } from '../src/services/sos.service.js';

test('SOS SMS includes the specific trip driver details', () => {
  const message = formatSosSms({
    employeeName: 'Anita Rao',
    employeeContact: '9000000001',
    tripReference: 'TRP-260716-001',
    driverName: 'Ravi Kumar',
    driverContact: '9000000002',
    reason: 'Unsafe situation',
    location: '12.9716,77.5946',
  });

  assert.match(message, /Employee: Anita Rao/);
  assert.match(message, /Employee phone: 9000000001/);
  assert.match(message, /Trip: TRP-260716-001/);
  assert.match(message, /Driver: Ravi Kumar/);
  assert.match(message, /Driver phone: 9000000002/);
  assert.match(message, /maps\.google\.com\/\?q=12\.9716,77\.5946/);
});

test('SOS SMS clearly states when no trip or driver is assigned', () => {
  const message = formatSosSms({ employeeName: 'Anita Rao' });
  assert.match(message, /Trip: Not linked/);
  assert.match(message, /Driver: Not assigned/);
});
