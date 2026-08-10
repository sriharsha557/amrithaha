import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, topItems } from '../js/lib/summary.js';

const orders = [
  { total_amount: 100, payment_mode: 'cash', status: 'valid' },
  { total_amount: 250, payment_mode: 'upi',  status: 'valid' },
  { total_amount: 999, payment_mode: 'upi',  status: 'invalid' },
];

test('summarise counts only valid orders', () => {
  assert.deepEqual(summarise(orders), { count: 2, revenue: 350, cash: 100, upi: 250 });
});

test('summarise handles an empty day', () => {
  assert.deepEqual(summarise([]), { count: 0, revenue: 0, cash: 0, upi: 0 });
});

test('topItems sums duplicate names, ranks by quantity, respects the limit', () => {
  const items = [
    { item_name: 'Dosa',  quantity: 3 },
    { item_name: 'Shake', quantity: 4 },
    { item_name: 'Idli',  quantity: 1 },
    { item_name: 'Dosa',  quantity: 2 },
  ];
  // Dosa totals 5, Shake 4, Idli 1. Limit of 2 drops Idli.
  assert.deepEqual(topItems(items, 2), [
    { name: 'Dosa',  quantity: 5 },
    { name: 'Shake', quantity: 4 },
  ]);
});

test('topItems breaks quantity ties alphabetically', () => {
  const items = [
    { item_name: 'Shake', quantity: 2 },
    { item_name: 'Dosa',  quantity: 2 },
  ];
  assert.deepEqual(topItems(items, 2), [
    { name: 'Dosa',  quantity: 2 },
    { name: 'Shake', quantity: 2 },
  ]);
});
