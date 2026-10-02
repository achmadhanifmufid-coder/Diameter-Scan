# Scan Cone Tahap 1 — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app statis untuk HP yang memotret tray 10×10, mengukur diameter bukaan atas setiap pre-roll cone, lalu menandai PASS / REJECT / CEK MANUAL. Termasuk alat laporan PoC yang membandingkan hasil kamera dengan gauge.

**Architecture:** Semua proses berjalan di browser HP, tanpa server. Inti pengukuran (`measure.js`, `homography.js`, `csv.js`) adalah modul ES murni tanpa DOM: bisa diuji di Node dan nanti bisa dipindah ke server. Tahapannya: foto → grayscale → cari bukaan gelap → cocokkan ke grid 10×10 (homografi mm↔px) → 180 garis per slot untuk mencari tepi sub-piksel → fit r(θ) → kalibrasi a·d+b → status. `index.html` hanya berisi tampilan dan penghubung.

**Tech Stack:** JavaScript ES modules (tanpa framework, tanpa OpenCV, tanpa dependensi runtime), Node ≥ 22 untuk uji (`node --test`, `zlib.crc32`), Python `http.server` untuk server lokal, hosting statis (GitHub Pages atau Cloudflare Pages).

**Spec:** `docs/superpowers/specs/2026-09-29-cone-scanner-design.md`. Semua kode di rencana ini sudah diprototipekan dan lolos uji: 31 uji otomatis, ditambah pengecekan UI di browser desktop dan mode HP.

## Global Constraints

- Tidak ada server dan foto tidak pernah di-upload. Semua pengukuran berjalan di browser.
- Tidak ada dependensi runtime. Satu-satunya dependensi dev yang diizinkan adalah `jpeg-js`, hanya di Task 9.
- Toleransi terkunci ±0,20 mm (`CONFIG.toleranceMm = 0.2`). Nilai tepat di batas dihitung PASS. Keputusan dihitung dalam satuan 0,01 mm (`classify`).
- Status hanya `PASS`, `REJECT`, atau `CEK_MANUAL`. Pengukuran yang meragukan tidak boleh menjadi PASS.
- Ukuran bawaan: 12,5 / 11,8 / 10,8 / 9,8 mm. Ukuran tambahan: angka 5–20 mm, disimpan per HP (localStorage), dan bisa dihapus.
- Posisi: baris A–J dari atas ke bawah, kolom 1–10 dari kiri ke kanan, sesuai foto. A1 = kiri atas.
- CSV: pemisah `;`, desimal `,`, UTF-8 dengan BOM, baris CRLF. Kolom persis seperti `HEADER` di Task 5.
- Teks UI dalam Bahasa Indonesia. Angka yang tampil memakai koma desimal. Selain warna, selalu ada simbol atau teks.
- Data produksi (`samples/`, `poc/`) tidak ikut di-commit, karena repo bisa publik untuk hosting.
- Nama author git untuk repo ini adalah "scan cone" (sudah diset). Nama lengkap user tidak boleh dipakai. Setiap pesan commit diakhiri dengan `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push ke GitHub atau deploy hanya dilakukan setelah user mengonfirmasi.

## Peta file

| File | Tanggung jawab | Task |
|---|---|---|
| `package.json`, `.gitignore` | modul ES, skrip test, abaikan data produksi | 1 |
| `homography.js` | aljabar linear kecil + homografi mm↔px | 1 |
| `config.js` | ukuran, toleransi, data tray, kalibrasi, ambang | 2 |
| `test/synth.js` | pembuat foto tray buatan (ukuran pasti) untuk uji | 2 |
| `measure.js` | grayscale, klasifikasi, deteksi grid, ukur tepi, `measureTray` | 2–4 |
| `csv.js` | format CSV untuk Excel Indonesia | 5 |
| `index.html` | tampilan: pilih ukuran, scan, overlay, detail, CSV, demo | 6 |
| `tools/make-demo.js`, `demo/tray-12.5.png` | foto tray buatan untuk demo tanpa tray fisik | 6 |
| `tools/report.js` | laporan PoC: kalibrasi a,b + 6 kriteria | 7 |
| `README.md` | cara pakai, uji, deploy | 8 |
| `tools/snapshot.js`, `test/samples.test.js`, `test/snapshots/` | uji regresi foto asli | 9 |

---

### Task 1: Setup proyek + homografi

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `homography.js`
- Test: `test/homography.test.js`

**Interfaces:**
- Consumes: —
- Produces (semua matriks `H` = array 9 angka row-major, `H[8] = 1`):
  - `solveLinear(A: number[][], b: number[]) → number[] | null` (null jika singular)
  - `leastSquares(rows: number[][], rhs: number[]) → number[] | null`
  - `apply(H, x, y) → [u, v]`
  - `multiply(A, B) → H`
  - `invert(H) → H`
  - `localScale(H, x, y) → number` (px per mm di sekitar titik tray (x, y) mm)
  - `fitHomography(src: [x,y][], dst: [u,v][]) → H | null` (≥ 4 pasang, kuadrat terkecil)

- [x] **Step 1: Buat `package.json` dan `.gitignore`**

`package.json`:
```json
{
  "name": "scan-cone",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/*.test.js\""
  }
}
```

`.gitignore`:
```
node_modules/
# Data produksi: jangan ikut ter-commit (repo bisa publik untuk hosting)
samples/
poc/
```

- [x] **Step 2: Tulis uji yang gagal — `test/homography.test.js`**

```js
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
```

- [x] **Step 3: Jalankan uji, pastikan gagal**

Run: `node --test test/homography.test.js`
Expected: FAIL — `Cannot find module '...homography.js'`

- [x] **Step 4: Tulis `homography.js`**

```js
// Homografi 3×3 (row-major, H[8] = 1): memetakan titik tray (mm) ↔ foto (px).

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Kuadrat terkecil lewat persamaan normal: rows·x ≈ rhs.
export function leastSquares(rows, rhs) {
  const n = rows[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  rows.forEach((row, k) => {
    for (let i = 0; i < n; i++) {
      b[i] += row[i] * rhs[k];
      for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j];
    }
  });
  return solveLinear(A, b);
}

export function apply(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function multiply(A, B) {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j];
  return C;
}

export function invert(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const adj = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  return adj.map((v) => v / adj[8]);
}

// Skala lokal (px per mm) di sekitar titik tray (x, y).
export function localScale(H, x, y) {
  const [u0, v0] = apply(H, x, y);
  const [u1, v1] = apply(H, x + 1, y);
  const [u2, v2] = apply(H, x, y + 1);
  return Math.sqrt(Math.abs((u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0)));
}

// Normalisasi Hartley supaya fit stabil secara numerik.
function normalizer(pts) {
  let mx = 0, my = 0, d = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  for (const [x, y] of pts) d += Math.hypot(x - mx, y - my);
  const s = (Math.SQRT2 * pts.length) / (d || 1);
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

// Homografi src → dst dari ≥ 4 pasang titik (kuadrat terkecil). null jika degenerate.
export function fitHomography(src, dst) {
  if (src.length < 4) return null;
  const Ts = normalizer(src), Td = normalizer(dst);
  const rows = [], rhs = [];
  for (let k = 0; k < src.length; k++) {
    const [x, y] = apply(Ts, src[k][0], src[k][1]);
    const [u, v] = apply(Td, dst[k][0], dst[k][1]);
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v]); rhs.push(v);
  }
  const h = leastSquares(rows, rhs);
  if (!h) return null;
  const H = multiply(invert(Td), multiply([...h, 1], Ts));
  return H.map((v) => v / H[8]);
}
```

- [x] **Step 5: Jalankan uji, pastikan lolos**

Run: `npm test`
Expected: `ℹ tests 4` · `ℹ pass 4` · `ℹ fail 0`

- [x] **Step 6: Commit**

```bash
git add package.json .gitignore homography.js test/homography.test.js
git commit -m "feat: add homography math with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Konfigurasi, gambar buatan, grayscale & klasifikasi

**Files:**
- Create: `config.js`
- Create: `test/synth.js`
- Create: `measure.js`
- Test: `test/measure.test.js`

**Interfaces:**
- Consumes: `apply`, `invert`, `localScale` dari `homography.js` (di `test/synth.js`)
- Produces:
  - `CONFIG` (lihat kode). Semua fungsi berikutnya menerima `cfg` dengan bentuk yang sama.
  - `makeTray(opts) → { gray: Float32Array, width, height, H }`. `opts.cone(row, col)` bisa mengembalikan `null` (lubang kosong), `{ d }`, atau `{ major, minor, angleDeg }` dalam mm. `H` adalah homografi tray-mm → px; default `[pxPerMm,0,margin·px,0,pxPerMm,margin·px,0,0,1]` dengan `pxPerMm = 8`, `marginMm = 20`, `pitchMm = 20`.
  - `median(values: number[]) → number` (NaN untuk array kosong)
  - `toGray(rgba, width, height) → Float32Array`
  - `classify(dMm, nominalMm, tolMm) → 'PASS' | 'REJECT'`

- [x] **Step 1: Tulis `config.js`**

```js
// Pengaturan bersama untuk semua HP. Ubah di sini, lalu deploy ulang.
export const CONFIG = {
  sizesMm: [12.5, 11.8, 10.8, 9.8],
  toleranceMm: 0.2, // terkunci: PASS = nominal ± 0,20 mm
  // Jarak pusat lubang tray = (pusat lubang 1 → pusat lubang 10) ÷ 9. Ganti dengan hasil ukur tray.
  tray: { rows: 10, cols: 10, pitchColMm: 20, pitchRowMm: 20 },
  calibration: { a: 1, b: 0 }, // d_kal = a·d_rata + b — diganti dengan hasil PoC
  // Ambang: titik awal, disetel dengan foto asli saat PoC.
  darkOffset: 10, // bukaan harus lebih gelap dari rata-rata sekitarnya (level abu-abu)
  minCones: 20, // minimal cone yang cocok ke grid
  minPxPerMm: 6, // resolusi minimal
  searchMm: 2, // jendela cari tepi: jari-jari nominal ± ini (cukup untuk semua ukuran bawaan)
  minRayEdge: 3, // gradien minimal per garis (level abu-abu per px)
  maxBlurMm: 0.35, // lebar tepi (blur) maksimal; lebih dari ini = foto buram (bias diameter > 0,02 mm)
  minValidFraction: 0.7, // minimal 70% dari 180 garis punya tepi
  maxRmsMm: 0.1, // sisa fit maksimal
  plausibleMm: 1.5, // |d − nominal| lebih dari ini → CEK MANUAL
  sizeMismatchMm: 0.35, // median tray sejauh ini dari nominal → peringatan ukuran
  maxImagePx: 16_000_000, // batas canvas iPhone
};
```

- [x] **Step 2: Tulis `test/synth.js` (pembuat foto buatan, dipakai uji Task 3–4 dan demo Task 6)**

```js
// Pembuat foto tray buatan untuk uji: bukaan gelap (lingkaran/oval) di latar terang, ukuran pasti.
import { apply, invert, localScale } from '../homography.js';

// PRNG kecil (mulberry32) supaya noise selalu sama di setiap run.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blur(img, w, h, sigma) {
  const r = Math.ceil(3 * sigma), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b);
  const tmp = new Float32Array(img.length), out = new Float32Array(img.length);
  const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += img[y * w + clamp(x + i, w)] * k[i + r];
      tmp[y * w + x] = s / sum;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[clamp(y + i, h) * w + x] * k[i + r];
      out[y * w + x] = s / sum;
    }
  return out;
}

/**
 * cone(row, col) → null (lubang kosong) | { d } | { major, minor, angleDeg } — semua dalam mm.
 * H = homografi tray-mm → px; default: tampak lurus dari atas, skala pxPerMm, margin marginMm.
 */
export function makeTray({
  rows = 10, cols = 10, pitchMm = 20, pxPerMm = 8, marginMm = 20,
  cone = () => ({ d: 12.5 }), H, width, height,
  blurPx = 1, noise = 2, dark = 60, bright = 210, seed = 1,
} = {}) {
  H ??= [pxPerMm, 0, marginMm * pxPerMm, 0, pxPerMm, marginMm * pxPerMm, 0, 0, 1];
  width ??= Math.round(((cols - 1) * pitchMm + 2 * marginMm) * pxPerMm);
  height ??= Math.round(((rows - 1) * pitchMm + 2 * marginMm) * pxPerMm);
  const Hi = invert(H), shapes = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const s = cone(r, c);
      if (!s) continue;
      const t = ((s.angleDeg ?? 0) * Math.PI) / 180;
      shapes[r * cols + c] = {
        cx: c * pitchMm, cy: r * pitchMm, a: (s.major ?? s.d) / 2, b: (s.minor ?? s.d) / 2,
        cos: Math.cos(t), sin: Math.sin(t), k: localScale(H, c * pitchMm, r * pitchMm),
      };
    }
  let img = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [mx, my] = apply(Hi, x, y);
      const c = Math.round(mx / pitchMm), r = Math.round(my / pitchMm);
      const s = r >= 0 && r < rows && c >= 0 && c < cols ? shapes[r * cols + c] : null;
      let cover = 0;
      if (s) { // jarak bertanda ke tepi oval ≈ f/|∇f|, diubah ke px → anti-aliasing 1 px
        const dx = mx - s.cx, dy = my - s.cy;
        const u = dx * s.cos + dy * s.sin, v = -dx * s.sin + dy * s.cos;
        const f = (u / s.a) ** 2 + (v / s.b) ** 2 - 1;
        const grad = Math.hypot((2 * u) / s.a ** 2, (2 * v) / s.b ** 2) || 1;
        cover = Math.min(1, Math.max(0, 0.5 - (f / grad) * s.k));
      }
      img[y * width + x] = bright - (bright - dark) * cover;
    }
  if (blurPx > 0) img = blur(img, width, height, blurPx);
  if (noise > 0) {
    const rand = rng(seed);
    for (let i = 0; i < img.length; i++) {
      const g = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
      img[i] = Math.min(255, Math.max(0, img[i] + noise * g));
    }
  }
  return { gray: img, width, height, H };
}
```

- [x] **Step 3: Tulis uji yang gagal — `test/measure.test.js`**

```js
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
```

- [x] **Step 4: Jalankan uji, pastikan gagal**

Run: `node --test test/measure.test.js`
Expected: FAIL — `Cannot find module '...measure.js'`

- [x] **Step 5: Tulis `measure.js` (versi awal)**

```js
// Inti pengukuran: fungsi murni tanpa DOM, jadi bisa diuji di Node dan dipindah ke server.

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
```

- [x] **Step 6: Jalankan uji, pastikan lolos**

Run: `npm test`
Expected: `ℹ tests 6` · `ℹ pass 6` · `ℹ fail 0`

- [x] **Step 7: Commit**

```bash
git add config.js test/synth.js measure.js test/measure.test.js
git commit -m "feat: add config, synthetic tray generator, gray and classify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Deteksi grid 10×10

**Files:**
- Modify: `measure.js` (tambah baris import di paling atas + dua fungsi di akhir file)
- Test: `test/grid.test.js`

**Interfaces:**
- Consumes: `apply`, `invert`, `localScale`, `fitHomography` (Task 1); `median` (Task 2); `makeTray` (Task 2)
- Produces:
  - `findCandidates(gray, w, h, cfg) → { x, y }[]` (pusat bukaan dalam px foto resolusi penuh)
  - `fitGrid(cands, cfg) → { H, Hi, cand, matched, pxPerMm } | { error }`
    - `H`: tray-mm → px. Slot (row, col) berada di mm `(col·pitchColMm, row·pitchRowMm)`, dan A1 = (0, 0) = kiri atas foto.
    - `Hi = invert(H)`.
    - `cand`: array sepanjang `rows·cols`, indeks `row·cols + col` → kandidat `{x, y}` atau `null`.
    - `error`: `'TOO_FEW_CONES'` atau `'TRAY_NOT_COMPLETE'`.

- [x] **Step 1: Tulis uji yang gagal — `test/grid.test.js`**

```js
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
```

- [x] **Step 2: Jalankan uji, pastikan gagal**

Run: `node --test test/grid.test.js`
Expected: FAIL — `findCandidates is not a function` (atau SyntaxError: export tidak ditemukan)

- [x] **Step 3: Tambah import di baris pertama `measure.js` (tepat di bawah komentar judul)**

```js
import { apply, invert, localScale, fitHomography } from './homography.js';
```

- [x] **Step 4: Tambah `findCandidates` dan `fitGrid` di akhir `measure.js`**

```js
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
```

- [x] **Step 5: Jalankan uji, pastikan lolos**

Run: `npm test`
Expected: `ℹ tests 12` · `ℹ pass 12` · `ℹ fail 0`

- [x] **Step 6: Commit**

```bash
git add measure.js test/grid.test.js
git commit -m "feat: detect cone openings and fit the 10x10 tray grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ukur tepi tiap slot + `measureTray`

**Files:**
- Modify: `measure.js` (ganti baris import, tambah konstanta di bawahnya, tambah fungsi di akhir file)
- Test: `test/measure.test.js` (ganti seluruh isi)

**Interfaces:**
- Consumes: semua fungsi Task 1–3.
- Produces:
  - `RAYS = 180`
  - `measureSlot(gray, w, h, grid, s, nominalMm, cfg) → { cx, cy, dMean, dMin, dMax, valid, rmsMm, x, y, rPx, blurPx } | null`. Satuannya: mm untuk `cx`, `cy`, `d*`, dan `rmsMm`; px untuk `x`, `y`, `rPx`, dan `blurPx`.
  - `measureTray(gray, w, h, nominalMm, cfg, sizesMm = cfg.sizesMm) → Result`. Bentuk `Result`:
    - `{ ok: false, error: 'TOO_FEW_CONES'|'TRAY_NOT_COMPLETE'|'LOW_RESOLUTION'|'BLURRY', nominalMm, lowerMm, upperMm, pxPerMm?, blurMm? }`
    - `{ ok: true, nominalMm, lowerMm, upperMm, pxPerMm, blurMm, slots, counts: { PASS, REJECT, CEK_MANUAL }, warnings: [{ code: 'SIZE_MISMATCH', medianMm, suggestedMm }] }`
    - `slots` = 100 item `{ pos: 'A1', row, col, x, y, status, rPx?, dRaw?, dMm?, dMinMm?, dMaxMm?, validRays?, rmsMm?, blurPx? }`. Field bertanda `?` hanya ada kalau tepi ditemukan. `x`/`y` adalah posisi px di foto; `dMm`, `dMinMm`, dan `dMaxMm` sudah dikalibrasi.

- [x] **Step 1: Ganti seluruh isi `test/measure.test.js` (uji yang gagal)**

```js
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
```

- [x] **Step 2: Jalankan uji, pastikan gagal**

Run: `node --test test/measure.test.js`
Expected: FAIL — `measureTray` tidak diekspor

- [x] **Step 3: Ganti baris import di `measure.js` dan tambah konstanta tepat di bawahnya**

```js
import { apply, invert, localScale, leastSquares, fitHomography } from './homography.js';

export const RAYS = 180;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
```

- [x] **Step 4: Tambah fungsi pengukuran di akhir `measure.js`**

```js
function sample(g, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return -1;
  const fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}

// Tepi pada satu garis: turunan gelap→terang terbesar, posisi sub-piksel (parabola). null jika tidak jelas.
// blur = lebar tepi (px) = kontras / (gradien puncak·√(2π)); tidak terpengaruh terang-gelapnya foto.
function edgeOnRay(gray, w, h, cx, cy, dx, dy, t0, t1, minGrad) {
  const step = 0.5, n = Math.floor((t1 - t0) / step) + 1;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = sample(gray, w, h, cx + (t0 + i * step) * dx, cy + (t0 + i * step) * dy);
    if (v < 0) return null;
    p[i] = v;
  }
  const d = (i) => (p[i + 2] - p[i - 2]) / 2; // gradien per px
  let best = -1, g = -Infinity;
  for (let i = 2; i < n - 2; i++) { const v = d(i); if (v > g) { g = v; best = i; } }
  if (best < 3 || best > n - 4 || g < minGrad) return null;
  const a = d(best - 1), c = d(best + 1), den = a - 2 * g + c;
  const contrast = (p[n - 1] + p[n - 2] + p[n - 3] - p[0] - p[1] - p[2]) / 3;
  return { t: t0 + (best + (den < 0 ? (0.5 * (a - c)) / den : 0)) * step, blur: contrast / (g * Math.sqrt(2 * Math.PI)) };
}

function circleFit(pts) {
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  const sol = leastSquares(pts.map(([x, y]) => [x - mx, y - my, 1]), pts.map(([x, y]) => -((x - mx) ** 2 + (y - my) ** 2)));
  if (!sol) return null;
  const cx = -sol[0] / 2, cy = -sol[1] / 2;
  return { cx: cx + mx, cy: cy + my };
}

// Titik tepi (mm) → pusat, buang titik menyimpang, lalu r(θ) ≈ r0 + harmonik ke-1 dan ke-2.
function fitRim(pts) {
  if (pts.length < 20) return null;
  let c = circleFit(pts);
  if (!c) return null;
  const r = pts.map(([x, y]) => Math.hypot(x - c.cx, y - c.cy));
  const med = median(r), mad = 1.4826 * median(r.map((v) => Math.abs(v - med)));
  const keep = pts.filter((_, i) => Math.abs(r[i] - med) <= Math.max(3 * mad, 0.02));
  if (keep.length < 20 || !(c = circleFit(keep))) return null;
  const rows = [], rad = [];
  for (const [x, y] of keep) {
    const t = Math.atan2(y - c.cy, x - c.cx);
    rows.push([1, Math.cos(t), Math.sin(t), Math.cos(2 * t), Math.sin(2 * t)]);
    rad.push(Math.hypot(x - c.cx, y - c.cy));
  }
  const k = leastSquares(rows, rad);
  if (!k) return null;
  let ss = 0;
  rows.forEach((row, i) => { ss += (rad[i] - row.reduce((s, v, j) => s + v * k[j], 0)) ** 2; });
  const a2 = Math.hypot(k[3], k[4]);
  return { cx: c.cx + k[1], cy: c.cy + k[2], dMean: 2 * k[0], dMin: 2 * (k[0] - a2), dMax: 2 * (k[0] + a2), valid: keep.length, rmsMm: Math.sqrt(ss / keep.length) };
}

// Satu slot: 180 garis dari pusat, dua putaran (putaran 2 dimulai dari pusat hasil putaran 1).
export function measureSlot(gray, w, h, grid, s, nominalMm, cfg) {
  const { cols, pitchColMm: pc, pitchRowMm: pr } = cfg.tray;
  const col = s % cols, row = (s - col) / cols;
  let [cx, cy] = grid.cand[s] ? [grid.cand[s].x, grid.cand[s].y] : apply(grid.H, col * pc, row * pr);
  let fit = null, blurPx = 0;
  for (let pass = 0; pass < 2; pass++) {
    const [mx, my] = apply(grid.Hi, cx, cy), k = localScale(grid.H, mx, my);
    const t0 = Math.max(1, (nominalMm / 2 - cfg.searchMm) * k), t1 = (nominalMm / 2 + cfg.searchMm) * k;
    const pts = [], blur = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (2 * Math.PI * i) / RAYS, dx = Math.cos(a), dy = Math.sin(a);
      const e = edgeOnRay(gray, w, h, cx, cy, dx, dy, t0, t1, cfg.minRayEdge);
      if (e) { pts.push(apply(grid.Hi, cx + e.t * dx, cy + e.t * dy)); blur.push(e.blur); }
    }
    if (!(fit = fitRim(pts))) return null;
    blurPx = median(blur);
    [cx, cy] = apply(grid.H, fit.cx, fit.cy);
  }
  return { ...fit, x: cx, y: cy, rPx: (fit.dMean / 2) * localScale(grid.H, fit.cx, fit.cy), blurPx };
}

// Seluruh tray: grid → ukur 100 slot → kalibrasi → status → peringatan.
export function measureTray(gray, w, h, nominalMm, cfg, sizesMm = cfg.sizesMm) {
  const base = { nominalMm, lowerMm: nominalMm - cfg.toleranceMm, upperMm: nominalMm + cfg.toleranceMm };
  const grid = fitGrid(findCandidates(gray, w, h, cfg), cfg);
  if (grid.error) return { ...base, ok: false, error: grid.error };
  if (grid.pxPerMm < cfg.minPxPerMm) return { ...base, ok: false, error: 'LOW_RESOLUTION', pxPerMm: grid.pxPerMm };
  const { rows, cols, pitchColMm: pc, pitchRowMm: pr } = cfg.tray, { a, b } = cfg.calibration;
  const slots = [], fitted = [];
  for (let s = 0; s < rows * cols; s++) {
    const col = s % cols, row = (s - col) / cols, pos = LETTERS[row] + (col + 1);
    const m = measureSlot(gray, w, h, grid, s, nominalMm, cfg);
    if (!m) {
      const [x, y] = apply(grid.H, col * pc, row * pr);
      slots.push({ pos, row, col, x, y, status: 'CEK_MANUAL' });
      continue;
    }
    const dMm = a * m.dMean + b;
    const good = m.valid >= cfg.minValidFraction * RAYS && m.rmsMm <= cfg.maxRmsMm;
    if (good) fitted.push(dMm);
    slots.push({
      pos, row, col, x: m.x, y: m.y, rPx: m.rPx,
      dRaw: m.dMean, dMm, dMinMm: a * m.dMin + b, dMaxMm: a * m.dMax + b,
      validRays: m.valid, rmsMm: m.rmsMm, blurPx: m.blurPx,
      status: good && Math.abs(dMm - nominalMm) <= cfg.plausibleMm ? classify(dMm, nominalMm, cfg.toleranceMm) : 'CEK_MANUAL',
    });
  }
  const blurMm = median(slots.filter((s) => s.blurPx).map((s) => s.blurPx)) / grid.pxPerMm;
  if (!(blurMm <= cfg.maxBlurMm)) return { ...base, ok: false, error: 'BLURRY', pxPerMm: grid.pxPerMm, blurMm };
  const counts = { PASS: 0, REJECT: 0, CEK_MANUAL: 0 };
  for (const s of slots) counts[s.status]++;
  const warnings = [];
  if (fitted.length) {
    const med = median(fitted);
    if (Math.abs(med - nominalMm) > cfg.sizeMismatchMm) {
      const suggestedMm = sizesMm.reduce((p, q) => (Math.abs(q - med) < Math.abs(p - med) ? q : p));
      warnings.push({ code: 'SIZE_MISMATCH', medianMm: med, suggestedMm });
    }
  }
  return { ...base, ok: true, pxPerMm: grid.pxPerMm, blurMm, slots, counts, warnings };
}
```

- [x] **Step 5: Jalankan uji, pastikan lolos**

Run: `npm test`
Expected: `ℹ tests 23` · `ℹ pass 23` · `ℹ fail 0` (±10 detik; uji gambar buatan butuh ±0,5–1 detik masing-masing)

- [x] **Step 6: Commit**

```bash
git add measure.js test/measure.test.js
git commit -m "feat: measure each cone rim with radial sub-pixel edges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ekspor CSV

**Files:**
- Create: `csv.js`
- Test: `test/csv.test.js`

**Interfaces:**
- Consumes: bentuk `Result` dari Task 4 (`nominalMm`, `lowerMm`, `upperMm`, `pxPerMm`, `slots[]`)
- Produces:
  - `fmt(x, d = 2) → string` (koma desimal, `''` untuk undefined/null/NaN)
  - `HEADER: string[]`
  - `toCsv(result, { time: Date, fileName, note, ms }) → string` (BOM + CRLF)
  - `csvFileName(time: Date, nominalMm) → string`

- [ ] **Step 1: Tulis uji yang gagal — `test/csv.test.js`**

```js
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
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `node --test test/csv.test.js`
Expected: FAIL — `Cannot find module '...csv.js'`

- [ ] **Step 3: Tulis `csv.js`**

```js
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
```

- [ ] **Step 4: Jalankan uji, pastikan lolos**

Run: `npm test`
Expected: `ℹ tests 26` · `ℹ pass 26` · `ℹ fail 0`

- [ ] **Step 5: Commit**

```bash
git add csv.js test/csv.test.js
git commit -m "feat: export scan results as Excel-friendly CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tampilan web + gambar demo

**Files:**
- Create: `tools/make-demo.js`
- Create (hasil skrip): `demo/tray-12.5.png`
- Create: `index.html`
- Modify: `.claude/launch.json` (ganti isinya; sekarang menunjuk ke folder prototipe)

**Interfaces:**
- Consumes: `CONFIG`; `toGray`, `measureTray`, `Result` (Task 4); `fmt`, `toCsv`, `csvFileName` (Task 5); `makeTray` (Task 2).
- Produces: halaman `index.html`. Parameter URL `?demo=<path same-origin>` langsung memproses gambar itu.

- [ ] **Step 1: Tulis `tools/make-demo.js`**

```js
// Membuat foto tray buatan untuk mencoba app tanpa tray fisik: node tools/make-demo.js → demo/tray-12.5.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { makeTray } from '../test/synth.js';

// PNG abu-abu 8-bit tanpa dependensi (zlib bawaan Node).
function png(gray, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(gray[y * w + x])));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bit, tipe warna 0 = abu-abu
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Tray 12,5 mm dengan beberapa kasus: REJECT besar/kecil, oval, dan satu lubang kosong.
const special = { '0,3': { d: 12.82 }, '5,6': { d: 12.21 }, '9,1': { d: 12.74 }, '2,2': { major: 13, minor: 12.2, angleDeg: 40 }, '1,5': null };
const t = makeTray({ pxPerMm: 7, noise: 1.5, cone: (r, c) => (`${r},${c}` in special ? special[`${r},${c}`] : { d: 12.4 + ((r * 7 + c * 3) % 5) * 0.05 }) });
mkdirSync('demo', { recursive: true });
writeFileSync('demo/tray-12.5.png', png(t.gray, t.width, t.height));
console.log(`demo/tray-12.5.png ${t.width}×${t.height}`);
```

- [ ] **Step 2: Buat gambar demo**

Run: `node tools/make-demo.js`
Expected: `demo/tray-12.5.png 1540×1540` (file ±1,1 MB)

- [ ] **Step 3: Tulis `index.html`**

```html
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QC Scanner Cone</title>
<style>
  :root { --ink: #1f2328; --muted: #59636e; --bg: #ffffff; --line: #d1d9e0; --pass: #1a7f37; --reject: #cf222e; --check: #bc4c00; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f0f6fc; --muted: #9198a1; --bg: #0d1117; --line: #3d444d; --pass: #3fb950; --reject: #f85149; --check: #db6d28; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.25rem; margin: 0 0 12px; }
  button { font: inherit; color: inherit; background: none; border: 1px solid var(--line); border-radius: 8px; min-height: 44px; padding: 0 14px; cursor: pointer; }
  .sizes { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
  .sizes button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .muted { color: var(--muted); }
  label.field { display: block; margin: 12px 0; }
  input[type="text"] { width: 100%; min-height: 44px; font: inherit; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; }
  .scan { display: block; margin: 16px 0; padding: 18px; border-radius: 12px; background: #1a7f37; color: #fff; font-size: 1.3rem; font-weight: 700; text-align: center; cursor: pointer; }
  .summary { font-size: 1.2rem; font-weight: 700; }
  .pass { color: var(--pass); } .reject { color: var(--reject); } .check { color: var(--check); }
  canvas { display: block; width: 100%; height: auto; margin: 12px 0; border-radius: 8px; }
  .actions { display: flex; gap: 8px; } .actions button { flex: 1; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>QC Scanner Cone</h1>
  <div>Ukuran cone:</div>
  <div class="sizes" id="sizes"></div>
  <button id="delSize" hidden></button>
  <p id="tol" class="muted"></p>
  <label class="field">Catatan (opsional)<input type="text" id="note" autocomplete="off"></label>
  <label class="scan">📷 SCAN<input type="file" id="file" accept="image/*" hidden></label>
  <p id="msg" role="status"></p>
  <section id="result" hidden>
    <p class="summary" id="summary"></p>
    <p class="check" id="warn"></p>
    <canvas id="view" aria-label="Foto tray dengan hasil per cone"></canvas>
    <p id="detail" class="muted">Ketuk sebuah cone untuk melihat detailnya.</p>
    <p id="rejects" class="reject"></p>
    <p id="checks" class="check"></p>
    <div class="actions"><button id="again">Scan lagi</button><button id="csv">Download CSV</button></div>
  </section>
</main>
<script type="module">
import { CONFIG } from './config.js';
import { toGray, measureTray } from './measure.js';
import { fmt, toCsv, csvFileName } from './csv.js';

const $ = (id) => document.getElementById(id);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const label = (mm) => String(mm).replace('.', ',');
const COLOR = { PASS: '#1a7f37', REJECT: '#cf222e', CEK_MANUAL: '#bc4c00' };
const MARK = { PASS: '🟢 PASS', REJECT: '❌ REJECT', CEK_MANUAL: '⚠️ CEK MANUAL' };
const ERRORS = {
  TOO_FEW_CONES: 'Cone tidak terdeteksi (kurang dari 20). Pastikan seluruh tray terlihat dan lampu menyala.',
  TRAY_NOT_COMPLETE: 'Tray tidak terlihat utuh 10×10. Geser tray atau HP supaya seluruh tray masuk foto.',
  LOW_RESOLUTION: 'Resolusi terlalu rendah. Pakai kamera utama (1×) tanpa zoom, jarak ±40 cm.',
  BLURRY: 'Foto buram. Ulangi dengan HP diam (pakai timer 2 detik) dan lampu cukup terang.',
  READ_FAILED: 'Foto tidak bisa dibaca. Coba foto ulang.',
};

let custom = load('customSizes', []);
let size = load('size', CONFIG.sizesMm[0]);
let last = null;

function renderSizes() {
  const all = [...CONFIG.sizesMm, ...custom];
  if (!all.includes(size)) size = all[0];
  const buttons = all.map((mm) => {
    const b = document.createElement('button');
    b.textContent = label(mm);
    b.setAttribute('aria-pressed', String(mm === size));
    b.onclick = () => { size = mm; save('size', size); renderSizes(); };
    return b;
  });
  const add = document.createElement('button');
  add.textContent = '+';
  add.setAttribute('aria-label', 'Tambah ukuran');
  add.onclick = addSize;
  $('sizes').replaceChildren(...buttons, add);
  $('delSize').hidden = !custom.includes(size);
  $('delSize').textContent = `Hapus ukuran ${label(size)}`;
  $('tol').textContent = `Toleransi: ${fmt(size - CONFIG.toleranceMm)}–${fmt(size + CONFIG.toleranceMm)} mm 🔒`;
}

function addSize() {
  const text = prompt('Ukuran baru (mm), misalnya 13,2:');
  if (text === null) return;
  const mm = Math.round(Number(text.trim().replace(',', '.')) * 100) / 100;
  if (!(mm >= 5 && mm <= 20) || [...CONFIG.sizesMm, ...custom].includes(mm)) {
    alert('Ukuran harus angka 5–20 mm dan belum ada di daftar.');
    return;
  }
  custom = [...custom, mm].sort((a, b) => b - a);
  size = mm;
  save('customSizes', custom);
  save('size', size);
  renderSizes();
}

$('delSize').onclick = () => {
  if (!confirm(`Hapus ukuran ${label(size)}?`)) return;
  custom = custom.filter((mm) => mm !== size);
  size = CONFIG.sizesMm[0];
  save('customSizes', custom);
  save('size', size);
  renderSizes();
};

$('note').value = load('note', '');
$('note').onchange = () => save('note', $('note').value);
$('file').onchange = () => { const f = $('file').files[0]; if (f) scan(f, f.name); };
$('again').onclick = () => { $('file').value = ''; $('file').click(); };
$('csv').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toCsv(last.result, last)], { type: 'text/csv' }));
  a.download = csvFileName(last.time, last.result.nominalMm);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function showError(code) {
  $('msg').className = 'reject';
  $('msg').textContent = ERRORS[code] ?? code;
}

async function scan(blob, fileName) {
  const t0 = performance.now();
  $('result').hidden = true;
  $('msg').className = '';
  $('msg').textContent = 'Mengukur…';
  await new Promise((r) => setTimeout(r, 30)); // beri waktu teks "Mengukur…" tampil
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { return showError('READ_FAILED'); }
  const k = Math.min(1, Math.sqrt(CONFIG.maxImagePx / (bitmap.width * bitmap.height)));
  const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const result = measureTray(toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h, size, CONFIG, [...CONFIG.sizesMm, ...custom]);
  if (!result.ok) return showError(result.error);
  last = { result, time: new Date(), fileName, note: $('note').value };
  draw(result, bitmap, w);
  last.ms = Math.round(performance.now() - t0);
  $('msg').textContent = `Selesai dalam ${label((last.ms / 1000).toFixed(1))} detik.`;
}

function draw(result, bitmap, w) {
  const view = $('view'), k = Math.min(1, 1600 / w);
  view.width = Math.round(w * k);
  view.height = Math.round((bitmap.height * w * k) / bitmap.width);
  const g = view.getContext('2d');
  g.drawImage(bitmap, 0, 0, view.width, view.height);
  const r0 = (result.nominalMm / 2) * result.pxPerMm * k; // jari-jari nominal di layar
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const s of result.slots) {
    const x = s.x * k, y = s.y * k;
    g.strokeStyle = g.fillStyle = COLOR[s.status];
    g.lineWidth = Math.max(2, r0 * 0.08);
    if (s.rPx) { g.beginPath(); g.arc(x, y, s.rPx * k, 0, 2 * Math.PI); g.stroke(); }
    if (s.status === 'PASS') {
      g.beginPath(); g.arc(x, y, r0 * 0.35, 0, 2 * Math.PI); g.fill();
    } else if (s.status === 'REJECT') {
      const d = r0 * 0.5;
      g.lineWidth = Math.max(3, r0 * 0.2);
      g.beginPath(); g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x + d, y - d); g.lineTo(x - d, y + d); g.stroke();
    } else {
      g.font = `bold ${Math.round(r0 * 1.2)}px system-ui`;
      g.fillText('?', x, y);
    }
  }
  g.font = `bold ${Math.round(r0 * 0.9)}px system-ui`; // label baris A–J dan kolom 1–10
  g.lineWidth = Math.max(3, r0 * 0.25);
  g.strokeStyle = '#fff';
  g.fillStyle = '#000';
  const text = (t, x, y) => { g.strokeText(t, x, y); g.fillText(t, x, y); };
  for (const s of result.slots) {
    if (s.col === 0) text(s.pos[0], s.x * k - r0 * 1.8, s.y * k);
    if (s.row === 0) text(String(s.col + 1), s.x * k, s.y * k - r0 * 1.8);
  }
  const n = result.counts, span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  $('summary').replaceChildren(`${label(result.nominalMm)} mm · `, span('pass', `🟢 ${n.PASS}`), '  ', span('reject', `❌ ${n.REJECT}`), '  ', span('check', `⚠️ ${n.CEK_MANUAL}`));
  $('warn').textContent = result.warnings.map((wn) => `⚠️ Rata-rata cone ${fmt(wn.medianMm)} mm, jauh dari ukuran yang dipilih (${label(result.nominalMm)}). Cek pilihan ukuran — terdekat: ${label(wn.suggestedMm)}.`).join(' ');
  const list = (status) => result.slots.filter((s) => s.status === status);
  $('rejects').textContent = list('REJECT').length ? `❌ REJECT: ${list('REJECT').map((s) => `${s.pos} ${fmt(s.dMm)}`).join(' · ')}` : '';
  $('checks').textContent = list('CEK_MANUAL').length ? `⚠️ CEK MANUAL: ${list('CEK_MANUAL').map((s) => s.pos).join(' · ')}` : '';
  $('detail').textContent = 'Ketuk sebuah cone untuk melihat detailnya.';
  view.onclick = (e) => {
    const rect = view.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * view.width / k, y = ((e.clientY - rect.top) / rect.height) * view.height / k;
    const s = result.slots.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b));
    $('detail').textContent = s.dMm === undefined
      ? `${s.pos} · ${MARK[s.status]} · tepi bukaan tidak ditemukan`
      : `${s.pos} · ${fmt(s.dMm)} mm · ${MARK[s.status]} · min ${fmt(s.dMinMm)} / maks ${fmt(s.dMaxMm)} · terima ${fmt(result.lowerMm)}–${fmt(result.upperMm)} mm`;
  };
  $('result').hidden = false;
}

renderSizes();
const demo = new URLSearchParams(location.search).get('demo'); // mis. ?demo=demo/tray-12.5.png
if (demo && new URL(demo, location.href).origin === location.origin) {
  fetch(demo).then((r) => r.blob()).then((b) => scan(b, demo.split('/').pop()));
}
</script>
</body>
</html>
```

- [ ] **Step 4: Ganti isi `.claude/launch.json` supaya menyajikan folder repo**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "scan-cone",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8000"],
      "port": 8000
    }
  ]
}
```

- [ ] **Step 5: Verifikasi di browser (desktop)**

Jalankan server lewat preview "scan-cone", atau `python -m http.server 8000` dari folder repo. Buka `http://localhost:8000/?demo=demo/tray-12.5.png`. Yang harus terlihat:
- Teks status `Selesai dalam 0,x detik.` (di bawah 3 detik).
- Ringkasan `12,5 mm · 🟢 96  ❌ 3  ⚠️ 1`.
- `❌ REJECT: A4 12,82 · F7 12,20 · J2 12,73`. Selisih ±0,01 masih wajar karena perbedaan kecil `Math` antar browser.
- `⚠️ CEK MANUAL: B6`.
- Di foto: lingkaran hijau dengan titik hijau di setiap cone, ✗ merah di A4/F7/J2, `?` oranye di B6, serta label A–J di kiri dan 1–10 di atas.
- Ketuk cone A4 → detail `A4 · 12,82 mm · ❌ REJECT · min … / maks … · terima 12,30–12,70 mm`.
- Ketuk B6 → `B6 · ⚠️ CEK MANUAL · tepi bukaan tidak ditemukan`.
- Console browser tanpa error.
- Klik **+**, isi `13,2`: tombol `13,2` muncul dan terpilih, toleransi menjadi `13,00–13,40 mm`, dan tombol `Hapus ukuran 13,2` muncul. Klik hapus lalu konfirmasi: ukuran kembali ke 12,5.
- Klik **+**, isi `abc`: muncul alert `Ukuran harus angka 5–20 mm dan belum ada di daftar.`
- Klik **Download CSV**: file `scan_…_12.5.csv` terunduh. Buka di Excel dan pastikan kolomnya terpisah benar dan angkanya berkoma.

- [ ] **Step 6: Verifikasi di layar HP**

Pakai emulasi 375×812 di browser, atau buka dari HP di WiFi yang sama: `http://<IP-PC>:8000/?demo=demo/tray-12.5.png`. Pastikan:
- Tombol ukuran tidak terpotong, foto memenuhi lebar layar, tanda ✗ dan ? terbaca, dan ketuk-detail berfungsi.
- Di HP sungguhan, catat teks `Selesai dalam … detik`. Harus di bawah 3 detik.
- Kalau ada iPhone, coba juga di Safari untuk mengecek batas memori canvas: memilih foto kamera 12 MP dari galeri tidak boleh membuat halaman crash.

- [ ] **Step 7: Jalankan semua uji**

Run: `npm test`
Expected: `ℹ tests 26` · `ℹ pass 26` · `ℹ fail 0`

- [ ] **Step 8: Commit**

```bash
git add index.html tools/make-demo.js demo/tray-12.5.png .claude/launch.json
git commit -m "feat: add phone web UI with overlay, details, CSV and demo tray

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Alat laporan PoC

**Files:**
- Create: `tools/report.js`
- Test: `test/report.test.js`

**Interfaces:**
- Consumes: `classify` (Task 2); format CSV app (Task 5); format data PoC di spec bagian 8.
- Produces:
  - `parseCsv(text) → object[]` (pemisah `;` atau `,` dideteksi dari baris judul)
  - `analyze({ gauge, layouts, scans }, calHp?) → { calHp, a, b, criteria, disagree, sizes, gaugeSd, lights }`
    - `criteria[i] = { name, kind, value, pass: true | false | null }`, dengan `null` = data uji belum ada.
  - `formatReport(report) → string`
  - CLI: `node tools/report.js [folder]`, membaca `folder/gauge.csv`, `folder/layout_*.csv`, dan `folder/scans/*.csv`.

- [ ] **Step 1: Tulis uji yang gagal — `test/report.test.js`**

```js
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
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `node --test test/report.test.js`
Expected: FAIL — `Cannot find module '...tools/report.js'`

- [ ] **Step 3: Tulis `tools/report.js`**

```js
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
```

- [ ] **Step 4: Jalankan uji, pastikan lolos**

Run: `npm test`
Expected: `ℹ tests 31` · `ℹ pass 31` · `ℹ fail 0`

- [ ] **Step 5: Smoke test CLI dengan data kecil**

Pakai folder sementara di luar repo: folder scratchpad sesi, atau `mktemp -d`. **Jangan** pakai `poc/`, karena folder itu nanti berisi data PoC asli.

```bash
SMOKE=$(mktemp -d)
mkdir -p "$SMOKE/scans"
printf 'cone_id;ukuran;gauge_1;gauge_2;gauge_3;operator\r\nc1;12,5;12,45;12,46;12,44;X\r\nc2;12,5;12,60;12,61;12,59;X\r\nc3;12,5;12,80;12,80;12,81;X\r\n' > "$SMOKE/gauge.csv"
printf 'posisi;cone_id\nE5;c1\nE6;c2\nF5;c3\n' > "$SMOKE/layout_T.csv"
for i in 1 2 3; do printf '\xef\xbb\xbfwaktu;catatan;posisi;diameter_mentah_mm;status;durasi_ms\r\nx;layout=T hp=A54 lampu=1 uji=2;E5;12,4%s;PASS;800\r\nx;layout=T hp=A54 lampu=1 uji=2;E6;12,6%s;PASS;800\r\nx;layout=T hp=A54 lampu=1 uji=2;F5;12,8%s;REJECT;800\r\n' $i $i $i > "$SMOKE/scans/u2_$i.csv"; done
node tools/report.js "$SMOKE"
rm -rf "$SMOKE"
```

Expected: baris pertama `Kalibrasi (uji 2, HP A54): d_kal = … × d_mentah + …`, lalu `LOLOS  1. Pengulangan …`, `BELUM  2. Akurasi …` (belum ada uji 3–5), `BELUM  4a. …`, `BELUM  4b. …`, `LOLOS  5. …`, `LOLOS  6. …`, dan `Gauge: 2×SD ulang = 0,018 mm`.

- [ ] **Step 6: Commit**

```bash
git add tools/report.js test/report.test.js
git commit -m "feat: add PoC report comparing scanner with gauge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: README + deploy

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: dokumentasi singkat dan app yang ter-hosting (URL HTTPS) setelah user mengonfirmasi.

- [ ] **Step 1: Tulis `README.md`**

~~~markdown
# Scan Cone

QC scanner diameter atas pre-roll cone. Foto tray 10×10 dari HP → diameter bukaan setiap cone → PASS / REJECT / CEK MANUAL. Semua proses berjalan di browser HP; foto tidak di-upload ke mana pun.

Desain lengkap: `docs/superpowers/specs/2026-09-29-cone-scanner-design.md`

## Mencoba di PC

```bash
python -m http.server 8000
```

Buka `http://localhost:8000/?demo=demo/tray-12.5.png` untuk contoh tanpa tray fisik. Dari HP di WiFi yang sama: `http://<IP-PC>:8000/`.

## Uji otomatis (Node ≥ 22)

```bash
npm test
```

## Setelah mengukur tray dan menjalankan PoC

- `config.js` → `tray.pitchColMm` dan `tray.pitchRowMm` = (jarak pusat lubang 1 → lubang 10) ÷ 9.
- Simpan data PoC di `poc/` (tidak ikut di-commit): `gauge.csv`, `layout_<nama>.csv`, dan `scans/*.csv` (CSV dari app). Isi kolom catatan di app dengan `layout=<nama> hp=<model> lampu=<n> uji=<n>`.
- `node tools/report.js` → salin angka `a` dan `b` ke `config.js` → `calibration`.
- `node tools/make-demo.js` membuat ulang gambar demo.
~~~

- [ ] **Step 2: Jalankan semua uji**

Run: `npm test`
Expected: `ℹ tests 31` · `ℹ pass 31` · `ℹ fail 0`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage, tests and PoC steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Tanyakan pilihan hosting ke user (JANGAN push sebelum ada konfirmasi)**

Sampaikan dua pilihan berikut:
- **GitHub Pages:** paling sederhana, tapi repo harus **publik**. Isinya hanya kode dan gambar demo, karena `samples/` dan `poc/` sudah di-ignore.
- **Cloudflare Pages:** repo boleh **private**, tapi langkah setup-nya lebih banyak.

Nama repo: `scan-cone`, bukan nama lengkap user. Akun GitHub/Cloudflare dibuat sendiri oleh user.

- [ ] **Step 5a: Jika GitHub Pages dipilih (setelah user membuat repo kosong `scan-cone` dan memberi URL-nya)**

```bash
git remote add origin https://github.com/<akun-user>/scan-cone.git
git push -u origin main
```

Lalu minta user membuka **Settings → Pages**, memilih **Source: Deploy from a branch**, lalu **Branch: `main` / `(root)`**, dan **Save**. URL-nya menjadi `https://<akun-user>.github.io/scan-cone/`. Cek `…/scan-cone/?demo=demo/tray-12.5.png` dari HP.

- [ ] **Step 5b: Jika Cloudflare Pages dipilih (setelah user membuat repo private `scan-cone` dan push)**

Minta user membuka dashboard Cloudflare, lalu **Workers & Pages → Create → Pages → Connect to Git**. Pilih repo `scan-cone`, **Framework preset: None**, **Build command: (kosong)**, **Build output directory: `/`**, lalu **Save and Deploy**. Cek `https://scan-cone.pages.dev/?demo=demo/tray-12.5.png` dari HP.

---

### Task 9: Foto asli — uji regresi & penyetelan

**Dikerjakan setelah user menaruh foto asli di `samples/`** (file asli dari galeri, bukan lewat WhatsApp). Gunakan superpowers:systematic-debugging untuk setiap hasil yang tidak sesuai.

**Files:**
- Modify: `package.json` (devDependency `jpeg-js`)
- Create: `tools/snapshot.js`
- Create: `test/samples.test.js`
- Create: `test/snapshots/*.json` (hasil `tools/snapshot.js`)
- Modify: `config.js` (ambang yang disetel)

**Interfaces:**
- Consumes: `toGray`, `measureTray`, `CONFIG`.
- Produces: `test/snapshots/<nama>.json = { photo, nominalMm, ok, error, slots: { A1: { status, dRaw }, … } }`

- [ ] **Step 1: Pasang decoder JPEG khusus uji**

Run: `npm install --save-dev jpeg-js`
Expected: `package.json` punya `"devDependencies": { "jpeg-js": "…" }`, dan `node_modules/` tetap tidak ikut ter-commit (sudah di `.gitignore`).

- [ ] **Step 2: Tulis `tools/snapshot.js`**

```js
// Simpan hasil foto asli sebagai snapshot regresi: node tools/snapshot.js samples/IMG_1234.jpg 12.5
// Catatan: jpeg-js tidak memutar foto menurut EXIF (browser memutarnya), jadi label posisi di Node bisa
// berbeda dari app. Tidak masalah untuk regresi karena snapshot dan uji sama-sama berjalan di Node.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import jpeg from 'jpeg-js';
import { toGray, measureTray } from '../measure.js';
import { CONFIG } from '../config.js';

const [photo, size] = process.argv.slice(2);
const nominalMm = Number(size);
const img = jpeg.decode(readFileSync(photo), { maxMemoryUsageInMB: 1024 });
const r = measureTray(toGray(img.data, img.width, img.height), img.width, img.height, nominalMm, CONFIG);
const snap = { photo: basename(photo), nominalMm, ok: r.ok, error: r.error ?? null, slots: Object.fromEntries((r.slots ?? []).map((s) => [s.pos, { status: s.status, dRaw: s.dRaw }])) };
mkdirSync('test/snapshots', { recursive: true });
writeFileSync(`test/snapshots/${basename(photo).replace(/\.jpe?g$/i, '')}.json`, JSON.stringify(snap, null, 1));
console.log(r.ok
  ? `${r.counts.PASS} PASS · ${r.counts.REJECT} REJECT · ${r.counts.CEK_MANUAL} CEK · ${r.pxPerMm.toFixed(2)} px/mm · blur ${r.blurMm.toFixed(3)} mm`
  : `ERROR ${r.error}`);
```

- [ ] **Step 3: Tulis `test/samples.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { toGray, measureTray } from '../measure.js';
import { CONFIG } from '../config.js';

// Regresi foto asli: hasil setiap foto di samples/ harus sama dengan snapshot di test/snapshots/.
// Foto tidak ikut di-commit (data produksi), jadi uji dilewati kalau fotonya tidak ada.
const dir = 'test/snapshots';
const snaps = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : [];

for (const name of snaps) {
  const snap = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
  const photo = `samples/${snap.photo}`;
  test(`regresi ${snap.photo}`, { skip: !existsSync(photo) && 'foto tidak ada di samples/' }, () => {
    const img = jpeg.decode(readFileSync(photo), { maxMemoryUsageInMB: 1024 });
    const r = measureTray(toGray(img.data, img.width, img.height), img.width, img.height, snap.nominalMm, CONFIG);
    assert.equal(r.ok, snap.ok, r.error);
    if (!r.ok) return assert.equal(r.error, snap.error);
    for (const s of r.slots) {
      const e = snap.slots[s.pos];
      assert.equal(s.status, e.status, s.pos);
      if (e.dRaw !== undefined) assert.ok(Math.abs(s.dRaw - e.dRaw) <= 0.002, `${s.pos}: ${s.dRaw} vs ${e.dRaw}`);
    }
  });
}
```

- [ ] **Step 4: Periksa deteksi di app untuk setiap foto asli**

Jalankan `python -m http.server 8000`, buka `http://localhost:8000/`, lalu pilih foto dari `samples/` dengan tombol SCAN. Untuk setiap foto, catat:
- Apakah muncul error? Kalau ya, error yang mana?
- Apakah garis tepi (lingkaran) menempel di **tepi dalam bibir cone**?
- Berapa jumlah CEK MANUAL?
- Berapa angka `px/mm` dan `blur`? Jalankan `node tools/snapshot.js samples/<foto>.jpg 12.5` untuk melihatnya.

- [ ] **Step 5: Setel sesuai gejala (satu perubahan per percobaan, lalu ulangi Step 4)**

| Gejala | Yang diubah di `config.js` / kode |
|---|---|
| `TOO_FEW_CONES` padahal tray terlihat jelas | Turunkan `darkOffset` (misalnya 10 → 5). |
| `BLURRY` padahal foto tampak tajam | Naikkan `maxBlurMm` sedikit (misalnya 0,35 → 0,45). Catat nilai `blur` dari snapshot. |
| Lingkaran menempel di tepi yang salah (tepi luar atau bayangan) | Kecilkan `searchMm`, tapi jangan di bawah 1,5 karena peringatan salah ukuran masih harus berfungsi. |
| Bukaan justru **lebih terang** dari bibir cone | Di `edgeOnRay`, balik tandanya: `const d = (i) => (p[i - 2] - p[i + 2]) / 2;` dan `const contrast = (p[0] + p[1] + p[2] - p[n - 1] - p[n - 2] - p[n - 3]) / 3;`. Di `findCandidates`, ganti `small[…] < mean - cfg.darkOffset` menjadi `small[…] > mean + cfg.darkOffset`. |
| Banyak CEK MANUAL karena RMS tinggi | Periksa overlay. Kalau tepi bibir memang bergerigi, naikkan `maxRmsMm` (0,10 → 0,15). |

Setiap perubahan ambang harus dicatat alasannya di komentar `config.js`. Setelah setiap perubahan, `npm test` tetap harus lolos semua.

- [ ] **Step 6: Cek lubang kosong**

Minta user memotret tray dengan 3 lubang sengaja dikosongkan. Lubang kosong **tidak boleh** berstatus PASS.
- Kalau berstatus CEK_MANUAL atau REJECT: lanjut.
- Kalau ada yang PASS: **berhenti**, laporkan ke user beserta fotonya, lalu rancang pembedanya bersama (superpowers:brainstorming). Contoh pembeda: kecerahan bagian dalam lubang, atau ada/tidaknya cincin bibir kertas.

- [ ] **Step 7: Buat snapshot setelah deteksi benar**

Run (untuk setiap foto): `node tools/snapshot.js samples/<foto>.jpg <ukuran>`
Lalu: `npm test`
Expected: semua uji lolos, termasuk `regresi <foto>` sebanyak jumlah foto.

- [ ] **Step 8: Commit (tanpa foto)**

```bash
git add package.json package-lock.json tools/snapshot.js test/samples.test.js test/snapshots config.js measure.js
git commit -m "test: add real-photo regression snapshots and tuned thresholds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
