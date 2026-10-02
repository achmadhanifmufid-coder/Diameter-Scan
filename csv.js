// CSV untuk Excel berbahasa Indonesia: pemisah ';', desimal ',', UTF-8 dengan BOM, baris CRLF.

// Angka → teks dengan d desimal dan koma. Kosong jika tidak ada nilai.
export function fmt(x, d = 2) {
  if (x === undefined || x === null || Number.isNaN(x)) return '';
  return (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',');
}

const pad = (n) => String(n).padStart(2, '0');
const day = (t) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const clock = (t, sep) => [t.getHours(), t.getMinutes(), t.getSeconds()].map(pad).join(sep);
const cell = (v) => (/[";\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export const HEADER = [
  'waktu', 'file_foto', 'catatan', 'ukuran', 'batas_bawah', 'batas_atas', 'posisi',
  'diameter_mm', 'diameter_mentah_mm', 'diameter_min_mm', 'diameter_maks_mm',
  'status', 'titik_valid', 'rms_mm', 'px_per_mm', 'durasi_ms',
];

export function toCsv(result, { time, fileName = '', note = '', ms = '' }) {
  const head = [`${day(time)} ${clock(time, ':')}`, fileName, note, fmt(result.nominalMm), fmt(result.lowerMm), fmt(result.upperMm)];
  const rows = result.slots.map((s) => [
    ...head, s.pos, fmt(s.dMm), fmt(s.dRaw, 3), fmt(s.dMinMm), fmt(s.dMaxMm),
    s.status, s.validRays ?? '', fmt(s.rmsMm, 3), fmt(result.pxPerMm), ms,
  ]);
  return '﻿' + [HEADER, ...rows].map((r) => r.map((v) => cell(String(v))).join(';')).join('\r\n') + '\r\n';
}

export const csvFileName = (time, nominalMm) => `scan_${day(time)}_${clock(time, '-')}_${nominalMm}.csv`;
