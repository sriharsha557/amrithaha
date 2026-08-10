import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/lib/html.js';

test('escapes < and >', () => {
  assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
});

test('escapes &', () => {
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
});

test('escapes double and single quotes', () => {
  assert.equal(escapeHtml(`He said "hi" and 'bye'`), 'He said &quot;hi&quot; and &#39;bye&#39;');
});

test('a string with no special characters passes through unchanged', () => {
  assert.equal(escapeHtml('Millet Dosa'), 'Millet Dosa');
});

test('null becomes an empty string', () => {
  assert.equal(escapeHtml(null), '');
});

test('undefined becomes an empty string', () => {
  assert.equal(escapeHtml(undefined), '');
});

test('a realistic attack string is fully neutralised', () => {
  const result = escapeHtml('<img src=x onerror=alert(1)>');
  assert.equal(result, '&lt;img src=x onerror=alert(1)&gt;');
  assert.ok(!result.includes('<') && !result.includes('>'));
});
