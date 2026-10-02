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
