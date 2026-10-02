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
