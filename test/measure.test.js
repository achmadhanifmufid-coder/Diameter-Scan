import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTray } from './synth.js';
import { toGray, classify, measureTray } from '../measure.js';
import { CONFIG } from '../config.js';
import { multiply } from '../homography.js';

// Konfigurasi uji: jarak lubang 20 mm (sama dengan tray buatan), kalibrasi netral.
const cfg = { ...CONFIG, tray: { rows: 10, cols: 10, pitchColMm: 20, pitchRowMm: 20 }, calibration: { a: 1, b: 0 } };
const run = (t, nominal, c = cfg) => measureTray(t.gray, t.width, t.height, nominal, c);
const errors = (r, truth) => r.slots.filter((s) => s.dMm !== undefined).map((s) => s.dMm - truth(s.row, s.col));
const meanAbs = (e) => e.reduce((a, b) => a + Math.abs(b), 0) / e.length;
const maxAbs = (e) => Math.max(...e.map(Math.abs));

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

test('100 lingkaran 12,50 mm: semua PASS, akurat, A1 di kiri atas', () => {
  const r = run(makeTray(), 12.5);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { PASS: 100, REJECT: 0, CEK_MANUAL: 0 });
  const e = errors(r, () => 12.5);
  assert.ok(meanAbs(e) <= 0.01 && maxAbs(e) <= 0.02, `mean ${meanAbs(e)} max ${maxAbs(e)}`);
  const a1 = r.slots[0], j10 = r.slots[99];
  assert.equal(a1.pos, 'A1');
  assert.equal(j10.pos, 'J10');
  assert.ok(Math.hypot(a1.x - 160, a1.y - 160) < 1 && Math.hypot(j10.x - 1600, j10.y - 1600) < 1);
});

test('diameter bervariasi 12,00–12,99: akurat dan status sesuai', () => {
  const truth = (row, col) => 12 + (row * 10 + col) * 0.01;
  const r = run(makeTray({ cone: (row, col) => ({ d: truth(row, col) }) }), 12.5);
  const e = errors(r, truth);
  assert.ok(meanAbs(e) <= 0.01 && maxAbs(e) <= 0.02, `mean ${meanAbs(e)} max ${maxAbs(e)}`);
  for (const s of r.slots) {
    const d = truth(s.row, s.col);
    if (Math.abs(d - 12.3) > 0.02 && Math.abs(d - 12.7) > 0.02) assert.equal(s.status, classify(d, 12.5, 0.2), s.pos);
  }
});

test('oval 13×12: rata-rata ≈ 12,5, min ≈ 12, maks ≈ 13', () => {
  const r = run(makeTray({ cone: () => ({ major: 13, minor: 12, angleDeg: 30 }) }), 12.5);
  for (const s of r.slots) {
    assert.ok(Math.abs(s.dMm - 12.5) <= 0.03, `${s.pos} ${s.dMm}`);
    assert.ok(Math.abs(s.dMinMm - 12) <= 0.05 && Math.abs(s.dMaxMm - 13) <= 0.05, `${s.pos} ${s.dMinMm} ${s.dMaxMm}`);
  }
});

test('HP sedikit miring (putar 3° + perspektif): tetap akurat', () => {
  const tilt = [Math.cos(0.05), -Math.sin(0.05), 60, Math.sin(0.05), Math.cos(0.05), 20, 2.5e-5, -1.5e-5, 1];
  const r = run(makeTray({ H: multiply(tilt, [8, 0, 160, 0, 8, 160, 0, 0, 1]), width: 1900, height: 1900 }), 12.5);
  assert.equal(r.counts.PASS, 100);
  const e = errors(r, () => 12.5);
  assert.ok(meanAbs(e) <= 0.01 && maxAbs(e) <= 0.02, `mean ${meanAbs(e)} max ${maxAbs(e)}`);
});

test('kalibrasi a·d + b diterapkan ke diameter, min, dan maks', () => {
  const r = run(makeTray(), 12.5, { ...cfg, calibration: { a: 1.01, b: -0.1 } });
  const s = r.slots[0];
  assert.ok(Math.abs(s.dMm - (1.01 * s.dRaw - 0.1)) < 1e-12);
  assert.ok(Math.abs(s.dMinMm - s.dMm) < 0.05 && Math.abs(s.dMaxMm - s.dMm) < 0.05);
});

test('lubang kosong → CEK_MANUAL, sisanya tetap diukur', () => {
  const r = run(makeTray({ cone: (row, col) => (row === 4 && col === 4 ? null : { d: 12.5 }) }), 12.5);
  assert.equal(r.slots.find((s) => s.pos === 'E5').status, 'CEK_MANUAL');
  assert.equal(r.counts.PASS, 99);
});

test('salah pilih ukuran (cone 9,8, dipilih 12,5) → peringatan + saran 9,8, tidak ada PASS', () => {
  const r = run(makeTray({ cone: () => ({ d: 9.8 }) }), 12.5);
  assert.equal(r.ok, true);
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.warnings[0].code, 'SIZE_MISMATCH');
  assert.equal(r.warnings[0].suggestedMm, 9.8);
});

test('foto kosong → TOO_FEW_CONES', () => {
  assert.equal(run(makeTray({ cone: () => null }), 12.5).error, 'TOO_FEW_CONES');
});

test('hanya 3 baris terisi (tray tidak utuh) → TRAY_NOT_COMPLETE', () => {
  assert.equal(run(makeTray({ cone: (row) => (row < 3 ? { d: 12.5 } : null) }), 12.5).error, 'TRAY_NOT_COMPLETE');
});

test('resolusi 4 px/mm → LOW_RESOLUTION', () => {
  assert.equal(run(makeTray({ pxPerMm: 4 }), 12.5).error, 'LOW_RESOLUTION');
});

test('foto buram (blur 0,5 mm) → BLURRY', () => {
  assert.equal(run(makeTray({ blurPx: 4 }), 12.5).error, 'BLURRY');
});
