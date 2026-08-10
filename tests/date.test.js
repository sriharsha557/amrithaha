import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istBusinessDate } from '../js/lib/date.js';

test('daytime UTC maps to the same IST date', () => {
  assert.equal(istBusinessDate(new Date('2026-08-10T06:00:00Z')), '2026-08-10');
});

test('late IST evening is still the same business day', () => {
  // 20:30 IST on the 10th
  assert.equal(istBusinessDate(new Date('2026-08-10T15:00:00Z')), '2026-08-10');
});

test('after midnight IST rolls to the next business day', () => {
  // 00:30 IST on the 11th
  assert.equal(istBusinessDate(new Date('2026-08-10T19:00:00Z')), '2026-08-11');
});

test('exactly 18:30 UTC is the IST midnight boundary', () => {
  assert.equal(istBusinessDate(new Date('2026-08-10T18:30:00Z')), '2026-08-11');
  assert.equal(istBusinessDate(new Date('2026-08-10T18:29:59Z')), '2026-08-10');
});
