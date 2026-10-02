import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLinear, fitHomography, apply, invert, multiply, localScale } from '../homography.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('solveLinear menyelesaikan sistem 3×3, null jika singular', () => {
  const x = solveLinear([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  [2, 3, -1].forEach((v, i) => close(x[i], v, 1e-9));
  assert.equal(solveLinear([[1, 2], [2, 4]], [1, 2]), null);
});

test('fitHomography menemukan kembali homografi yang diketahui (skala + putar + perspektif)', () => {
  const Htrue = multiply([Math.cos(0.05), -Math.sin(0.05), 60, Math.sin(0.05), Math.cos(0.05), 20, 2.5e-5, -1.5e-5, 1], [8, 0, 160, 0, 8, 160, 0, 0, 1]);
  const src = [], dst = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { src.push([c * 20, r * 20]); dst.push(apply(Htrue, c * 20, r * 20)); }
  const H = fitHomography(src, dst);
  for (const [x, y] of [[0, 0], [180, 0], [90, 90], [180, 180]]) {
    const [u, v] = apply(H, x, y), [tu, tv] = apply(Htrue, x, y);
    close(u, tu, 1e-6, 'u'); close(v, tv, 1e-6, 'v');
  }
  const [x, y] = apply(invert(H), ...apply(H, 37, 121));
  close(x, 37, 1e-6); close(y, 121, 1e-6);
});

test('fitHomography butuh minimal 4 titik', () => {
  assert.equal(fitHomography([[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]]), null);
});

test('localScale = px per mm', () => {
  close(localScale([8, 0, 160, 0, 8, 160, 0, 0, 1], 50, 50), 8, 1e-9);
});
