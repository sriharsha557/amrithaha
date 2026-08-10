import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../js/lib/csv.js';

test('writes a header row and values in column order', () => {
  const csv = toCsv([{ a: 1, b: 2 }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n1,2');
});

test('quotes values containing commas', () => {
  const csv = toCsv([{ name: 'Dosa, Idli' }], ['name']);
  assert.equal(csv, 'name\r\n"Dosa, Idli"');
});

test('escapes embedded double quotes by doubling them', () => {
  const csv = toCsv([{ name: 'Ragi "special"' }], ['name']);
  assert.equal(csv, 'name\r\n"Ragi ""special"""');
});

test('renders null and undefined as empty cells', () => {
  const csv = toCsv([{ a: null, b: undefined }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n,');
});

test('neutralises a string starting with = to prevent formula injection', () => {
  const csv = toCsv([{ name: '=SUM(A1:A9)' }], ['name']);
  assert.equal(csv, "name\r\n'=SUM(A1:A9)");
});

test('neutralises a string starting with - to prevent formula injection', () => {
  const csv = toCsv([{ name: '-2+3+cmd|/c calc' }], ['name']);
  assert.equal(csv, "name\r\n'-2+3+cmd|/c calc");
});

test('does not neutralise the number -5', () => {
  const csv = toCsv([{ amount: -5 }], ['amount']);
  assert.equal(csv, 'amount\r\n-5');
});

test('leaves a normal string unaffected', () => {
  const csv = toCsv([{ name: 'Ragi Idli' }], ['name']);
  assert.equal(csv, 'name\r\nRagi Idli');
});
