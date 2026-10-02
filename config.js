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
