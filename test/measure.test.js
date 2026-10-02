import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGray, classify } from '../measure.js';

test('toGray: RGBA → luma', () => {
  const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 200, 200, 200, 255]), 3, 1);
  assert.deepEqual([...g].map((v) => Math.round(v * 10) / 10), [76.2, 29.1, 200]);
});

test('classify: batas ikut PASS, dihitung dalam 0,01 mm', () => {
  assert.equal(classify(12.3, 12.5, 0.2), 'PASS');
  assert.equal(classify(12.7, 12.5, 0.2), 'PASS');
  assert.equal(classify(12.29, 12.5, 0.2), 'REJECT');
  assert.equal(classify(12.71, 12.5, 0.2), 'REJECT');
  assert.equal(classify(11.6, 11.8, 0.2), 'PASS'); // 11.8 − 0.2 = 11.600000000000001 di JS
});
