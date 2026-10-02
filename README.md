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
