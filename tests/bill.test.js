import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLine, changeQty, removeLine, billTotal } from '../js/lib/bill.js';

const dosa  = { id: 'a', name: 'Millet Dosa', price: 80 };
const shake = { id: 'b', name: 'Protein Shake', price: 120 };

test('adding an item creates a line with quantity 1', () => {
  const lines = addLine([], dosa);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 1);
  assert.equal(lines[0].menu_item_id, 'a');
});

test('adding the same item again increments quantity, not lines', () => {
  const lines = addLine(addLine([], dosa), dosa);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 2);
});

test('changeQty removes the line when it reaches zero', () => {
  const lines = changeQty(addLine([], dosa), 'a', -1);
  assert.equal(lines.length, 0);
});

test('billTotal multiplies price by quantity across lines', () => {
  let lines = addLine([], dosa);
  lines = addLine(lines, dosa);
  lines = addLine(lines, shake);
  assert.equal(billTotal(lines), 280);
});

test('removeLine drops only the named line', () => {
  const lines = removeLine(addLine(addLine([], dosa), shake), 'a');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].menu_item_id, 'b');
});

test('input array is never mutated', () => {
  const original = addLine([], dosa);
  addLine(original, shake);
  assert.equal(original.length, 1);
});
