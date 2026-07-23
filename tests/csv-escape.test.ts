import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape } from '../src/routes/reports.js';

// M-1: report CSVs contain employee-controlled text (SOS reasons, address notes).
// A cell starting with = + - @ is executed as a formula when opened in Excel /
// Sheets, so those leading characters must be neutralised.

test('neutralises a leading = formula', () => {
  const out = csvEscape('=SUM(A1)*cmd');
  assert.ok(out.startsWith("'"), `expected leading quote, got ${out}`);
});

test('neutralises leading + - @ and tab', () => {
  assert.ok(csvEscape('+1+1').startsWith("'"));
  assert.ok(csvEscape('-2+3').startsWith("'"));
  assert.ok(csvEscape('@SUM(A1)').startsWith("'"));
  assert.ok(csvEscape('\tcmd').startsWith("'"));
});

test('a neutralised value that also needs quoting is still quoted', () => {
  // Leading '=' AND an embedded comma -> must be both prefixed and CSV-quoted.
  const out = csvEscape('=1,2');
  assert.ok(out.startsWith('"'), `expected CSV quoting, got ${out}`);
  assert.ok(out.includes("'=1,2"), `expected neutralised content, got ${out}`);
});

test('leaves ordinary values untouched', () => {
  assert.equal(csvEscape('Whitefield'), 'Whitefield');
  assert.equal(csvEscape('2026-07-11'), '2026-07-11'); // dates start with a digit
  assert.equal(csvEscape(5), '5');
  assert.equal(csvEscape(''), '');
  assert.equal(csvEscape(null), '');
});

test('still escapes embedded quotes by doubling', () => {
  assert.equal(csvEscape('a"b'), '"a""b"');
});
