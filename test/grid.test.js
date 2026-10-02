import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTray } from './synth.js';
import { findCandidates, fitGrid } from '../measure.js';
import { CONFIG } from '../config.js';
import { apply, multiply } from '../homography.js';

const cfg = { ...CONFIG, tray: { rows: 10, cols: 10, pitchColMm: 20, pitchRowMm: 20 } };
const grid = (t) => fitGrid(findCandidates(t.gray, t.width, t.height, cfg), cfg);

// Selisih terbesar (px) antara posisi slot hasil fit dan posisi sebenarnya.
function maxSlotError(g, t) {
  let max = 0;
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) {
      const [u, v] = apply(g.H, c * 20, r * 20), [tu, tv] = apply(t.H, c * 20, r * 20);
      max = Math.max(max, Math.hypot(u - tu, v - tv));
    }
  return max;
}

test('findCandidates: menemukan 100 bukaan', () => {
  const t = makeTray();
  assert.equal(findCandidates(t.gray, t.width, t.height, cfg).length, 100);
});

test('fitGrid: 100 slot tepat di tempatnya, A1 kiri atas, skala 8 px/mm', () => {
  const t = makeTray();
  const g = grid(t);
  assert.equal(g.matched, 100);
  assert.ok(Math.abs(g.pxPerMm - 8) < 0.01, `${g.pxPerMm}`);
  assert.ok(maxSlotError(g, t) < 0.5, `${maxSlotError(g, t)}`);
  const [x, y] = apply(g.H, 0, 0);
  assert.ok(Math.hypot(x - 160, y - 160) < 0.5); // A1 = pojok kiri atas foto
});

test('fitGrid: HP sedikit miring tetap tepat', () => {
  const tilt = [Math.cos(0.05), -Math.sin(0.05), 60, Math.sin(0.05), Math.cos(0.05), 20, 2.5e-5, -1.5e-5, 1];
  const t = makeTray({ H: multiply(tilt, [8, 0, 160, 0, 8, 160, 0, 0, 1]), width: 1900, height: 1900 });
  assert.ok(maxSlotError(grid(t), t) < 0.5);
});

test('fitGrid: kurang dari 20 kandidat → TOO_FEW_CONES', () => {
  assert.equal(fitGrid([], cfg).error, 'TOO_FEW_CONES');
});

test('fitGrid: baris paling luar kosong (label bisa bergeser) → TRAY_NOT_COMPLETE', () => {
  assert.equal(grid(makeTray({ cone: (row) => (row < 3 ? { d: 12.5 } : null) })).error, 'TRAY_NOT_COMPLETE');
});

test('fitGrid: tray terpotong + miring ekstrem → TRAY_NOT_COMPLETE, bukan hasil salah', () => {
  const strong = [1, 0.02, 10, -0.015, 1, 5, 0.00012, -0.00008, 1];
  const t = makeTray({ H: multiply(strong, [8, 0, 160, 0, 8, 160, 0, 0, 1]), width: 1650, height: 1650 });
  assert.equal(grid(t).error, 'TRAY_NOT_COMPLETE');
});
