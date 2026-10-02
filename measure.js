// Inti pengukuran: fungsi murni tanpa DOM, jadi bisa diuji di Node dan dipindah ke server.
import { apply, invert, localScale, fitHomography } from './homography.js';

export function median(values) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function toGray(rgba, width, height) {
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

// Keputusan dalam satuan 0,01 mm supaya angka tampil dan keputusan selalu sama.
export function classify(dMm, nominalMm, tolMm) {
  const d = Math.round(dMm * 100);
  return d >= Math.round((nominalMm - tolMm) * 100) && d <= Math.round((nominalMm + tolMm) * 100) ? 'PASS' : 'REJECT';
}

// Bukaan cone = blob gelap yang kira-kira bulat. Dicari di salinan kecil (±1000 px) supaya cepat.
export function findCandidates(gray, w, h, cfg) {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / 1000));
  const sw = Math.floor(w / f), sh = Math.floor(h / f);
  const small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += gray[(y * f + dy) * w + x * f + dx];
      small[y * sw + x] = s / (f * f);
    }
  const W = sw + 1, I = new Float64Array(W * (sh + 1)); // integral image → rata-rata lokal
  for (let y = 0; y < sh; y++) {
    let row = 0;
    for (let x = 0; x < sw; x++) { row += small[y * sw + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  const r = Math.max(4, Math.round(Math.max(sw, sh) / 20));
  const dark = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(sw, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(sh, y + r + 1);
      const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      dark[y * sw + x] = small[y * sw + x] < mean - cfg.darkOffset ? 1 : 0;
    }
  const seen = new Uint8Array(sw * sh), blobs = [], stack = [];
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    let n = 0, sx = 0, sy = 0, minX = sw, maxX = 0, minY = sh, maxY = 0;
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const p = stack.pop(), x = p % sw, y = (p - x) / sw;
      n++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && dark[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < sw - 1 && dark[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && dark[p - sw] && !seen[p - sw]) { seen[p - sw] = 1; stack.push(p - sw); }
      if (y < sh - 1 && dark[p + sw] && !seen[p + sw]) { seen[p + sw] = 1; stack.push(p + sw); }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (n >= 12 && n / (bw * bh) > 0.6 && Math.max(bw, bh) / Math.min(bw, bh) < 1.4) blobs.push({ n, x: sx / n, y: sy / n });
  }
  if (!blobs.length) return [];
  const med = median(blobs.map((b) => b.n));
  return blobs.filter((b) => b.n > med / 2 && b.n < med * 2).map((b) => ({ x: b.x * f + (f - 1) / 2, y: b.y * f + (f - 1) / 2 }));
}

// Cocokkan kandidat ke grid rows×cols → homografi tray (mm) → foto (px). A1 = kiri atas.
export function fitGrid(cands, cfg) {
  const { rows, cols, pitchColMm: pc, pitchRowMm: pr } = cfg.tray;
  if (cands.length < cfg.minCones) return { error: 'TOO_FEW_CONES' };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const d0 = median(cands.map((a) => Math.min(...cands.filter((b) => b !== a).map((b) => dist(a, b)))));
  let C = 0, S = 0; // arah grid: sudut vektor tetangga, dilipat per 90°
  for (const a of cands)
    for (const b of cands) {
      if (a === b || dist(a, b) > 1.3 * d0) continue;
      const t = 4 * Math.atan2(b.y - a.y, b.x - a.x);
      C += Math.cos(t); S += Math.sin(t);
    }
  const th = Math.atan2(S, C) / 4, ux = Math.cos(th), uy = Math.sin(th);
  const mx = median(cands.map((c) => c.x)), my = median(cands.map((c) => c.y));
  const o = cands.reduce((a, b) => (Math.hypot(a.x - mx, a.y - my) <= Math.hypot(b.x - mx, b.y - my) ? a : b));
  const idx = cands.map((c) => [
    Math.round(((c.x - o.x) * ux + (c.y - o.y) * uy) / d0),
    Math.round((-(c.x - o.x) * uy + (c.y - o.y) * ux) / d0),
  ]);
  const fit = (sel) => fitHomography(sel.map((k) => [idx[k][0] * pc, idx[k][1] * pr]), sel.map((k) => [cands[k].x, cands[k].y]));
  let sel = cands.map((_, k) => k);
  for (let it = 0; it < 3; it++) { // fit → tetapkan ulang indeks lewat homografi → buang yang di luar grid
    const H = fit(sel);
    if (!H) return { error: 'TRAY_NOT_COMPLETE' };
    const Hi = invert(H), best = new Map();
    cands.forEach((c, k) => {
      const [x, y] = apply(Hi, c.x, c.y), i = Math.round(x / pc), j = Math.round(y / pr);
      const e = Math.hypot(x - i * pc, y - j * pr);
      idx[k] = [i, j];
      if (e > 0.3 * Math.min(pc, pr)) return;
      const key = `${i},${j}`;
      if (!best.has(key) || best.get(key).e > e) best.set(key, { k, e });
    });
    sel = [...best.values()].map((v) => v.k);
    if (sel.length < cfg.minCones) return { error: 'TOO_FEW_CONES' };
  }
  const I = sel.map((k) => idx[k][0]), J = sel.map((k) => idx[k][1]);
  const iMin = Math.min(...I), iMax = Math.max(...I), jMin = Math.min(...J), jMax = Math.max(...J);
  if (iMax - iMin + 1 < cols || jMax - jMin + 1 < rows) return { error: 'TRAY_NOT_COMPLETE' };
  let win = null; // jendela rows×cols dengan kandidat terbanyak (abaikan deteksi di luar tray)
  for (let i0 = iMin; i0 <= iMax - cols + 1; i0++)
    for (let j0 = jMin; j0 <= jMax - rows + 1; j0++) {
      const n = sel.filter((k) => idx[k][0] >= i0 && idx[k][0] < i0 + cols && idx[k][1] >= j0 && idx[k][1] < j0 + rows).length;
      if (!win || n > win.n) win = { i0, j0, n };
    }
  sel = sel.filter((k) => idx[k][0] >= win.i0 && idx[k][0] < win.i0 + cols && idx[k][1] >= win.j0 && idx[k][1] < win.j0 + rows);
  if (sel.length < cfg.minCones) return { error: 'TOO_FEW_CONES' };
  if (sel.length < 0.7 * cands.length) return { error: 'TRAY_NOT_COMPLETE' }; // sebagian besar kandidat harus cocok ke grid
  const cand = new Array(rows * cols).fill(null);
  for (const k of sel) {
    idx[k] = [idx[k][0] - win.i0, idx[k][1] - win.j0];
    cand[idx[k][1] * cols + idx[k][0]] = cands[k];
  }
  const H = fit(sel);
  if (!H) return { error: 'TRAY_NOT_COMPLETE' };
  return { H, Hi: invert(H), cand, matched: sel.length, pxPerMm: localScale(H, ((cols - 1) * pc) / 2, ((rows - 1) * pr) / 2) };
}
