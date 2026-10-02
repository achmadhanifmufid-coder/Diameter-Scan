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
