import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../js/lib/amount.js';

test('empty string returns null', () => {
  assert.equal(parseAmount(''), null);
});

test('whitespace-only string returns null', () => {
  assert.equal(parseAmount('   '), null);
});

test('null returns null', () => {
  assert.equal(parseAmount(null), null);
});

test('undefined returns null', () => {
  assert.equal(parseAmount(undefined), null);
});

test('non-numeric string returns null', () => {
  assert.equal(parseAmount('abc'), null);
});

test('negative amount returns null', () => {
  assert.equal(parseAmount('-5'), null);
});

test('Infinity returns null', () => {
  assert.equal(parseAmount('Infinity'), null);
});

test('zero string returns 0', () => {
  assert.equal(parseAmount('0'), 0);
});

test('decimal string returns the decimal value', () => {
  assert.equal(parseAmount('12.50'), 12.5);
});

test('exponential notation string returns the numeric value', () => {
  assert.equal(parseAmount('1e3'), 1000);
});

test('surrounding whitespace is trimmed', () => {
  assert.equal(parseAmount(' 80 '), 80);
});

test('a plain number input is accepted', () => {
  assert.equal(parseAmount(80), 80);
});
