import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, toCsv, csvFileName, HEADER } from '../csv.js';

test('fmt: desimal koma, pembulatan, kosong untuk nilai tidak ada', () => {
  assert.equal(fmt(12.304), '12,30');
  assert.equal(fmt(12.305, 3), '12,305');
  assert.equal(fmt(11.600000000000001), '11,60');
  assert.equal(fmt(undefined), '');
  assert.equal(fmt(NaN), '');
});

test('toCsv: BOM, header, pemisah titik koma, catatan dengan ; diberi tanda kutip', () => {
  const result = {
    nominalMm: 12.5, lowerMm: 12.3, upperMm: 12.7, pxPerMm: 7.9,
    slots: [
      { pos: 'A1', dMm: 12.48, dRaw: 12.4812, dMinMm: 12.31, dMaxMm: 12.62, status: 'PASS', validRays: 176, rmsMm: 0.012 },
      { pos: 'A2', status: 'CEK_MANUAL' },
    ],
  };
  const time = new Date(2026, 8, 30, 10, 5, 7);
  const text = toCsv(result, { time, fileName: 'IMG_1.jpg', note: 'layout=A; hp="A54"', ms: 850 });
  assert.ok(text.startsWith('﻿'));
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[0], HEADER.join(';'));
  assert.equal(lines[1], '2026-09-30 10:05:07;IMG_1.jpg;"layout=A; hp=""A54""";12,50;12,30;12,70;A1;12,48;12,481;12,31;12,62;PASS;176;0,012;7,90;850');
  assert.equal(lines[2], '2026-09-30 10:05:07;IMG_1.jpg;"layout=A; hp=""A54""";12,50;12,30;12,70;A2;;;;;CEK_MANUAL;;;7,90;850');
  assert.equal(lines[3], '');
});

test('csvFileName: tanggal, jam, ukuran', () => {
  assert.equal(csvFileName(new Date(2026, 8, 30, 10, 5, 7), 12.5), 'scan_2026-09-30_10-05-07_12.5.csv');
});
