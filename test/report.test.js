import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, analyze, formatReport } from '../tools/report.js';

test('parseCsv: pemisah ; atau , , tanda kutip, BOM, CRLF, baris kosong', () => {
  assert.deepEqual(parseCsv('﻿a;b\r\n1,5;"x;""y"""\r\n\r\n'), [{ a: '1,5', b: 'x;"y"' }]);
  assert.deepEqual(parseCsv('a,b\n1.5,2\n'), [{ a: '1.5', b: '2' }]);
});

// Data PoC buatan: 4 cone, kamera "mentah" = (gauge + 0,3) / 1,02 → kalibrasi harus menemukan a = 1,02, b = −0,3.
const GAUGE = { c1: 12.35, c2: 12.45, c3: 12.6, c4: 12.8 };
const TENGAH = { c1: 'E5', c2: 'E6', c3: 'F5', c4: 'F6' };
const PINGGIR = { c1: 'A1', c2: 'A2', c3: 'J9', c4: 'J10' };
const raw = (cone, offset = 0) => ((GAUGE[cone] + offset + 0.3) / 1.02).toFixed(4).replace('.', ',');

function scan(file, note, layout, { offset = 0, checks = 0, ms = 900 } = {}) {
  const rows = Object.entries(layout).map(([cone, posisi]) => ({ catatan: note, posisi, diameter_mentah_mm: raw(cone, offset), status: 'PASS', durasi_ms: String(ms) }));
  for (let i = 0; i < checks; i++) rows.push({ catatan: note, posisi: `H${i + 1}`, diameter_mentah_mm: '', status: 'CEK_MANUAL', durasi_ms: String(ms) });
  return { file, rows };
}

function dataset({ phoneOffset = 0.01, checks = 0 } = {}) {
  const gauge = Object.entries(GAUGE).map(([cone_id, g]) => ({ cone_id, ukuran: '12,5', gauge_1: String(g).replace('.', ','), gauge_2: String(g + 0.01).replace('.', ','), gauge_3: String(g - 0.01).replace('.', ','), operator: 'X' }));
  const layout = (m) => Object.entries(m).map(([cone_id, posisi]) => ({ posisi, cone_id }));
  const scans = [];
  for (let i = 0; i < 5; i++) scans.push(scan(`u2_${i}.csv`, 'layout=T hp=A54 lampu=1 uji=2', TENGAH, { checks }));
  for (let i = 0; i < 3; i++) scans.push(scan(`u3_${i}.csv`, 'layout=T hp=A54 lampu=1 uji=3', TENGAH));
  scans.push(scan('u4_t.csv', 'layout=T hp=A54 lampu=1 uji=4', TENGAH), scan('u4_p.csv', 'layout=P hp=A54 lampu=1 uji=4', PINGGIR));
  for (let i = 0; i < 2; i++) scans.push(scan(`u5_${i}.csv`, 'layout=T hp=Redmi lampu=1 uji=5', TENGAH, { offset: phoneOffset }));
  return { gauge, layouts: { T: layout(TENGAH), P: layout(PINGGIR) }, scans };
}

test('analyze: kalibrasi ditemukan kembali dan semua kriteria lolos', () => {
  const r = analyze(dataset());
  assert.ok(Math.abs(r.a - 1.02) < 1e-3 && Math.abs(r.b + 0.3) < 1e-2, `a ${r.a} b ${r.b}`);
  for (const c of r.criteria) assert.equal(c.pass, true, c.name);
  assert.match(formatReport(r), /LOLOS {2}1\. Pengulangan/);
});

test('analyze: HP kedua bergeser 0,05 mm → kriteria 4a gagal', () => {
  const r = analyze(dataset({ phoneOffset: 0.05 }));
  assert.equal(r.criteria.find((c) => c.name.startsWith('4a')).pass, false);
});

test('analyze: 3 CEK MANUAL dalam satu scan → kriteria 5 gagal', () => {
  const r = analyze(dataset({ checks: 3 }));
  assert.equal(r.criteria.find((c) => c.name.startsWith('5.')).pass, false);
});

test('analyze: uji yang belum dikerjakan → BELUM, bukan GAGAL', () => {
  const d = dataset();
  d.scans = d.scans.filter((s) => !s.file.startsWith('u5') && !s.file.startsWith('u4'));
  const r = analyze(d);
  assert.equal(r.criteria.find((c) => c.name.startsWith('4a')).pass, null);
  assert.match(formatReport(r), /BELUM {2}4a\./);
});
