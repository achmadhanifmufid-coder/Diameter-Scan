// Laporan PoC: bandingkan CSV hasil scan dengan gauge, hitung kalibrasi (a, b), cek 6 kriteria lolos.
// Pakai: node tools/report.js [folder]   (default: poc)
//   folder/gauge.csv          cone_id;ukuran;gauge_1;gauge_2;gauge_3;operator
//   folder/layout_<nama>.csv  posisi;cone_id
//   folder/scans/*.csv        CSV dari app; catatan berisi "layout=<nama> hp=<model> lampu=<n> uji=<n>"
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classify } from '../measure.js';

const TOL = 0.2;
const num = (s) => (s === undefined || s === '' ? NaN : Number(String(s).replace(',', '.')));
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const variance = (v) => (v.length < 2 ? NaN : v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1));
const share = (v, ok) => (v.length ? v.filter(ok).length / v.length : NaN);
const tags = (note) => Object.fromEntries([...String(note ?? '').matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
const isEdge = (pos) => /^[AJ]/.test(pos) || /^[A-J](1|10)$/.test(pos);

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

// CSV dengan pemisah ';' atau ',' (dideteksi dari baris judul), tanda kutip, BOM, CRLF.
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = text.split('\n', 1)[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// data = { gauge: [baris gauge.csv], layouts: { nama: [baris layout] }, scans: [{ file, rows }] }
export function analyze(data, calHp) {
  const gauge = new Map(data.gauge.map((r) => {
    const v = [r.gauge_1, r.gauge_2, r.gauge_3].map(num).filter(Number.isFinite);
    return [r.cone_id, { size: num(r.ukuran), avg: mean(v), values: v }];
  }));
  const reads = [], scans = [];
  for (const { file, rows } of data.scans) {
    const t = tags(rows[0]?.catatan);
    const coneAt = new Map((data.layouts[t.layout] ?? []).map((r) => [r.posisi, r.cone_id]));
    scans.push({ file, ...t, checks: rows.filter((r) => r.status === 'CEK_MANUAL').length, ms: num(rows[0]?.durasi_ms) });
    for (const r of rows) {
      const ref = gauge.get(coneAt.get(r.posisi));
      const raw = num(r.diameter_mentah_mm);
      if (ref && Number.isFinite(raw)) reads.push({ ...t, file, pos: r.posisi, cone: coneAt.get(r.posisi), size: ref.size, gauge: ref.avg, raw });
    }
  }

  // Kalibrasi dari uji 2 dengan HP pertama: rata-rata scan per cone vs rata-rata gauge.
  calHp ??= reads.find((r) => r.uji === '2')?.hp;
  const calPairs = [...groupBy(reads.filter((r) => r.uji === '2' && r.hp === calHp), (r) => r.cone).values()].map((l) => [mean(l.map((r) => r.raw)), l[0].gauge]);
  if (calPairs.length < 2) throw new Error('Butuh data uji=2 untuk minimal 2 cone (cek kolom catatan: uji=2 hp=...).');
  const mx = mean(calPairs.map((p) => p[0])), my = mean(calPairs.map((p) => p[1]));
  const a = calPairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / calPairs.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const b = my - a * mx;
  const cal = (r) => a * r.raw + b;
  const coneMean = (list) => new Map([...groupBy(list, (r) => r.cone)].map(([k, l]) => [k, mean(l.map(cal))]));

  // 1. Pengulangan (uji 2 & 3): selisih tiap scan terhadap rata-rata cone itu.
  const devs = [];
  for (const l of groupBy(reads.filter((r) => r.uji === '2' || r.uji === '3'), (r) => `${r.uji}|${r.hp}|${r.layout}|${r.cone}`).values()) {
    const m = mean(l.map(cal));
    for (const r of l) devs.push(Math.abs(cal(r) - m));
  }
  // 2 & 3. Akurasi dan keputusan pada data yang tidak dipakai kalibrasi (uji 3–5).
  const val = reads.filter((r) => ['3', '4', '5'].includes(r.uji));
  const clear = val.filter((r) => Math.abs(r.gauge - (r.size - TOL)) > 0.05 && Math.abs(r.gauge - (r.size + TOL)) > 0.05);
  const disagree = clear.filter((r) => classify(cal(r), r.size, TOL) !== classify(r.gauge, r.size, TOL));
  // 4a. Antar HP (uji 5) terhadap HP pertama (uji 2).
  const ref = coneMean(reads.filter((r) => r.uji === '2' && r.hp === calHp));
  const phones = [...groupBy(reads.filter((r) => r.uji === '5'), (r) => r.hp)].map(([hp, l]) => {
    const d = [...coneMean(l)].filter(([c]) => ref.has(c)).map(([c, v]) => v - ref.get(c));
    return { hp, diff: mean(d) };
  });
  // 4b. Posisi (uji 4): pinggir (baris A/J, kolom 1/10) vs tengah, cone yang sama.
  const u4 = reads.filter((r) => r.uji === '4');
  const edge = coneMean(u4.filter((r) => isEdge(r.pos))), mid = coneMean(u4.filter((r) => !isEdge(r.pos)));
  const posD = [...edge].filter(([c]) => mid.has(c)).map(([c, v]) => v - mid.get(c));
  // Uji 6: ukuran lain dengan kalibrasi yang sama.
  const sizes = [...groupBy(reads.filter((r) => r.uji === '6'), (r) => r.size)].map(([size, l]) => ({ size, ok: share(l, (r) => Math.abs(cal(r) - r.gauge) <= 0.05) }));
  // Konsistensi gauge sendiri (2×SD gabungan) dan perbandingan lampu (uji 1).
  const gaugeSd = Math.sqrt(mean([...gauge.values()].map((g) => variance(g.values)).filter(Number.isFinite)));
  const lights = [...groupBy(scans.filter((s) => s.uji === '1'), (s) => s.lampu)].map(([lampu, l]) => {
    const files = new Set(l.map((s) => s.file));
    const sds = [...groupBy(reads.filter((r) => files.has(r.file)), (r) => r.cone).values()].map((x) => Math.sqrt(variance(x.map(cal)))).filter(Number.isFinite);
    return { lampu, checksPerScan: mean(l.map((s) => s.checks)), sd: mean(sds) };
  });

  const accurate = share(val, (r) => Math.abs(cal(r) - r.gauge) <= 0.05), repeat = share(devs, (d) => d <= 0.03);
  const verdict = (hasData, ok) => (hasData ? ok : null); // null = data uji belum ada
  const criteria = [
    { name: '1. Pengulangan ≤ 0,03 mm (≥ 95%)', kind: 'pct', value: repeat, pass: verdict(devs.length > 0, repeat >= 0.95) },
    { name: '2. Akurasi vs gauge ≤ 0,05 mm (≥ 95%)', kind: 'pct', value: accurate, pass: verdict(val.length > 0, accurate >= 0.95) },
    { name: '3. PASS/REJECT sama dengan gauge (cone tidak mepet batas)', kind: 'count', value: disagree.length, pass: verdict(clear.length > 0, disagree.length === 0) },
    { name: '4a. Selisih antar HP ≤ 0,02 mm', kind: 'phones', value: phones, pass: verdict(phones.length > 0, phones.every((p) => Math.abs(p.diff) <= 0.02)) },
    { name: '4b. Selisih pinggir vs tengah ≤ 0,02 mm', kind: 'mm', value: mean(posD), pass: verdict(posD.length > 0, Math.abs(mean(posD)) <= 0.02) },
    { name: '5. CEK MANUAL ≤ 2 per scan', kind: 'count', value: Math.max(...scans.map((s) => s.checks)), pass: verdict(scans.length > 0, scans.every((s) => s.checks <= 2)) },
    { name: '6. Waktu ≤ 3 detik', kind: 'ms', value: Math.max(...scans.map((s) => s.ms)), pass: verdict(scans.length > 0, scans.every((s) => s.ms <= 3000)) },
  ];
  return { calHp, a, b, criteria, disagree, sizes, gaugeSd, lights };
}

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');
const SHOW = {
  pct: (v) => `${f(v * 100, 1)}%`,
  mm: (v) => `${f(v)} mm`,
  ms: (v) => `${f(v, 0)} ms`,
  count: (v) => String(v),
  phones: (v) => v.map((p) => `${p.hp}: ${f(p.diff)} mm`).join(', ') || '—',
};

export function formatReport(r) {
  const out = [`Kalibrasi (uji 2, HP ${r.calHp}): d_kal = ${f(r.a, 4)} × d_mentah + ${f(r.b, 4)}`, ''];
  const verdict = { true: 'LOLOS', false: 'GAGAL', null: 'BELUM' };
  for (const c of r.criteria) out.push(`${verdict[c.pass]}  ${c.name}  [${SHOW[c.kind](c.value)}]`);
  for (const d of r.disagree) out.push(`  beda keputusan: ${d.file} ${d.pos} cone ${d.cone} gauge ${f(d.gauge, 2)}`);
  for (const s of r.sizes) out.push(`Uji 6 ukuran ${f(s.size, 1)}: ${f(s.ok * 100, 1)}% ≤ 0,05 mm → ${s.ok >= 0.95 ? 'kalibrasi sama berlaku' : 'perlu kalibrasi per ukuran'}`);
  out.push(`Gauge: 2×SD ulang = ${f(2 * r.gaugeSd)} mm${2 * r.gaugeSd > 0.05 ? ' → tinjau ambang kriteria 2' : ''}`);
  for (const l of r.lights) out.push(`Uji 1 lampu ${l.lampu}: CEK MANUAL/scan ${f(l.checksPerScan, 1)}, SD ulang ${f(l.sd)} mm`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'poc';
  const read = (p) => parseCsv(readFileSync(p, 'utf8'));
  const layouts = Object.fromEntries(readdirSync(dir).filter((n) => /^layout_.+\.csv$/.test(n)).map((n) => [n.slice(7, -4), read(join(dir, n))]));
  const scans = readdirSync(join(dir, 'scans')).filter((n) => n.endsWith('.csv')).sort().map((n) => ({ file: n, rows: read(join(dir, 'scans', n)) }));
  console.log(formatReport(analyze({ gauge: read(join(dir, 'gauge.csv')), layouts, scans })));
}
