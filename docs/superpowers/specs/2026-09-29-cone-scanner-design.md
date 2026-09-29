# Scanner Diameter Atas Pre-Roll Cone — Desain Tahap 1 (PoC)

- **Tanggal:** 2026-09-29
- **Status:** Draft, menunggu review user
- **Brief awal:** `C:\Users\PT Dutch Mill Intern\Downloads\pre_roll_cone_scanner_project_summary.md`

## 1. Tujuan

Menggantikan pengukuran manual satu per satu dengan tapered gauge. Operator mengisi tray 10×10, memotret dengan HP, dan dalam ≤ 3 detik melihat cone mana yang **PASS**, **REJECT**, atau perlu **CEK MANUAL**.

Tahap 1 terdiri dari web app sederhana dan PoC yang membuktikan **hasil kamera ≈ hasil gauge**. Fitur lain menunggu PoC lolos.

## 2. Penyesuaian terhadap brief awal

| Topik | Brief awal | Keputusan sekarang | Alasan |
|---|---|---|---|
| Tray | Rancang tray/fixture baru | Tray karton 10×10 yang sudah ada, dipakai apa adanya | Menurut user, cone yang dimasukkan ulang duduk di tinggi yang kurang lebih sama. Dibuktikan di uji 3 PoC. |
| HP | HP tetap di fixture | HP milik operator masing-masing | Keputusan user. Skala dihitung ulang dari setiap foto. |
| Patokan skala | Kalibrasi piksel→mm sekali | Pola lubang tray (jaraknya diketahui) di setiap foto | Tahan terhadap beda HP, beda posisi stand, dan HP yang sedikit miring. |
| Ukuran cone | Hanya 12,5 mm (12,3–12,7) | 12,5 / 11,8 / 10,8 / 9,8 + tambah ukuran. Toleransi terkunci ±0,20 mm. | Kebutuhan produksi. |
| Definisi diameter | Pertanyaan terbuka | Diameter rata-rata semua arah (≈ setara keliling). Min/maks ikut dicatat. | Kertas lentur ikut membulat pada gauge bulat, jadi keliling bukaan yang menentukan posisi berhenti. Dikonfirmasi oleh PoC. |
| Status hasil | PASS / REJECT | PASS / REJECT / CEK MANUAL | App tidak boleh memberi PASS dari pengukuran yang meragukan. |
| Urutan kerja | PoC dulu, app menyusul | PoC dijalankan memakai app tahap 1 | Kode PoC = kode produksi, jadi hasil validasi langsung berlaku. |
| Kriteria PoC | Kualitatif | 6 kriteria terukur (bagian 8) | Keputusan lanjut/berhenti menjadi jelas. |
| Penyimpanan | — | Tampil di layar + download CSV | Tanpa server di tahap 1. Supabase menyusul (hasil saja). |
| Bingkai bidik live | — | Tahap 2 | Usulan user. Dibangun setelah PoC lolos. |

## 3. Setup fisik

- **Tray:** tray karton 10×10 yang sudah ada. Semua ukuran cone memakai tray yang sama. Cone dimasukkan dengan cara yang konsisten: jatuhkan, lalu ketuk tray pelan. Jangan didorong kuat.
- **Penanda arah:** stiker kecil di satu sudut tray sebagai A1. Sudut ini selalu berada di kiri atas pada foto.
- **Penamaan posisi:** baris A–J dari atas ke bawah, kolom 1–10 dari kiri ke kanan, sesuai foto.
- **Stand HP:** stand overhead. Kamera berada ±40 cm di atas permukaan tray (35–45 cm boleh), dan **tingginya sama untuk setiap scan dan setiap stand**, karena kalibrasi hanya berlaku untuk tinggi tersebut. HP kira-kira sejajar dengan tray; kemiringan kecil dikoreksi otomatis.
- **Kamera:** kamera utama (1×), mode foto biasa, tanpa zoom atau filter. Gunakan timer 2 detik atau tombol volume supaya HP tidak goyang.
- **Lampu:** rata dan konsisten, dengan area yang agak tertutup dari cahaya luar. Jenis lampu dipilih di uji 1 PoC.
- **Data tray:** jarak pusat lubang 1 ke lubang 10, untuk satu baris dan satu kolom, diukur sekali dengan jangka sorong lalu dimasukkan ke `config.js`.

**Kenapa tinggi dan jarak penting:** benda yang lebih dekat ke kamera tampak lebih besar. Pada jarak 40 cm, selisih tinggi 1 mm menghasilkan error ≈ 0,03 mm pada cone 12,5 mm. Skala diambil dari posisi bibir cone itu sendiri, sehingga tinggi rata-rata cone di tray otomatis terkoreksi. Yang tersisa hanya variasi tinggi antar cone. Kalau variasi itu konsisten, kalibrasi ikut mengoreksinya; konsistensinya diuji di uji 3.

## 4. Arsitektur software

- Web app statis. Semua proses berjalan di browser HP, tanpa server, dan foto tidak di-upload.
- Hosting statis gratis (misalnya GitHub Pages, sudah HTTPS).
- JavaScript biasa, tanpa framework dan tanpa OpenCV.
- Inti pengukuran (`measure.js`) berupa fungsi murni tanpa DOM. Fungsi ini bisa diuji di Node dan nanti bisa dipindah ke server (opsi B) tanpa ditulis ulang.

```
D:\hanif\Scan\
├── index.html        tampilan + penghubung (input foto, overlay, daftar, CSV, pilihan ukuran)
├── measure.js        inti: deteksi grid, ukur tepi, kalibrasi, status, format CSV
├── config.js         ukuran bawaan, toleransi, data tray, kalibrasi, ambang kualitas
├── package.json      "type": "module", skrip test
├── test/             uji otomatis (node --test) + pembuat gambar buatan
├── tools/report.js   laporan PoC: kamera vs gauge + pengecekan 6 kriteria
├── samples/          foto asli untuk uji regresi
└── poc/              data PoC: gauge.csv, layout_*.csv, CSV hasil scan
```

## 5. Cara app mengukur

Masukan: foto (`File`), ukuran nominal, dan `config`. Keluaran: hasil per posisi, ringkasan, dan peringatan.

1. **Baca foto.** Foto dibaca dengan `createImageBitmap` (orientasi EXIF otomatis), digambar ke canvas, lalu diambil pikselnya. Foto di atas 16 MP diperkecil karena batas canvas di iPhone. Foto lalu diubah ke grayscale.
2. **Cari kandidat bukaan** pada salinan foto yang diperkecil. Bukaan cone diperkirakan tampak sebagai lingkaran yang lebih gelap dari karton dan bibir cone yang putih; ini dipastikan dengan foto asli. Caranya: threshold adaptif, lalu komponen terhubung, lalu saring berdasarkan ukuran dan kebulatan.
3. **Cocokkan kandidat ke pola 10×10.**
   - Dari jarak dan arah antar kandidat yang bertetangga, tentukan dua arah grid serta indeks baris dan kolom setiap kandidat.
   - Hitung **homografi** dari koordinat tray dalam mm (berdasarkan jarak lubang) ke koordinat piksel. Titik yang menyimpang dibuang, lalu homografi dihitung ulang.
   - Hasilnya: perkiraan posisi ke-100 slot, skala, dan koreksi kemiringan HP. A1 adalah slot kiri atas pada foto.
   - Minimal 20 cone harus cocok ke grid supaya homografi bisa dihitung. Tray yang tidak penuh tetap bisa discan; slot tanpa cone berstatus CEK MANUAL.
4. **Cari tepi bukaan di setiap slot**, pada resolusi penuh.
   - Tarik 180 garis dari titik tengah, setiap 2°.
   - Jendela pencarian: jari-jari nominal ± 1 mm.
   - Tepi adalah titik perubahan terang-gelap yang paling kuat. Polaritasnya (gelap-ke-terang atau sebaliknya) disetel dari foto asli.
   - Posisi tepi dihitung sampai sub-piksel dengan interpolasi parabola.
5. **Hitung diameter dalam mm.**
   - Titik tepi dipetakan ke koordinat tray (mm) lewat homografi.
   - Pusat bukaan difit ulang, lalu titik yang menyimpang (lebih dari 3×MAD) dibuang.
   - Jari-jari dimodelkan sebagai r(θ) ≈ r₀ + harmonik ke-1 + harmonik ke-2. Dari model ini:
     - `d_rata` = 2·r₀. Ini nilai utama, ≈ diameter setara keliling.
     - `d_min` dan `d_maks` diambil dari harmonik ke-2 (ovalitas).
6. **Kalibrasi:** `d_kal = a·d_rata + b`. Nilai awal a = 1 dan b = 0; diganti dengan hasil PoC. Kalibrasi yang sama diterapkan ke `d_min` dan `d_maks` sebelum ditampilkan dan diekspor.
7. **Status.** Dihitung dalam satuan 0,01 mm supaya tidak ada error pembulatan.
   - **CEK MANUAL** jika: slot tidak punya tepi yang jelas, titik valid < 70%, sisa fit (RMS) > 0,10 mm, atau `d_kal` di luar nominal ± 1,5 mm.
   - **PASS** jika nominal − 0,20 ≤ `d_kal` ≤ nominal + 0,20. Nilai tepat di batas dihitung PASS.
   - **REJECT** untuk selain itu.
8. **Pemeriksaan tingkat tray.**
   - Kalau median `d_kal` berjarak lebih dari 0,35 mm dari ukuran nominal, muncul peringatan "Cek pilihan ukuran" beserta saran ukuran terdekat. App **tidak pernah** mengganti ukuran secara otomatis, karena mesin yang bergeser bisa membuat tebakan otomatis meloloskan cone yang salah.
   - Kalau kualitas foto kurang, app menampilkan pesan dan meminta foto ulang. Yang dianggap kurang: tray tidak terlihat utuh, kurang dari 20 cone cocok ke grid, skala < 6 px/mm, atau foto buram (ketajaman tepi di bawah ambang).

Semua ambang (70% titik valid, RMS 0,10 mm, jendela ±1 mm, ±1,5 mm, 0,35 mm, 6 px/mm, 20 cone, ketajaman) adalah konstanta di `config.js`. Nilainya adalah titik awal dan disetel dengan foto asli saat PoC.

**Target waktu:** ≤ 3 detik dari foto dipilih sampai hasil tampil.

## 6. Tampilan (tahap 1)

```
┌───────────────────────────────┐      ┌───────────────────────────────┐
│ QC Scanner Cone               │      │ 12,5 mm · 🟢 96 ❌ 3 ⚠️ 1      │
│ Ukuran cone:                  │      │ ┌───────────────────────────┐ │
│ [12,5] [11,8] [10,8] [9,8] [+]│  →   │ │ foto tray + tanda tiap    │ │
│ Toleransi: 12,30–12,70 mm 🔒  │      │ │ cone (● ✗ ?) + label A–J  │ │
│ Catatan: [                  ] │      │ └───────────────────────────┘ │
│         [ 📷  SCAN ]          │      │ ❌ REJECT: A4 12,82 · F7 12,21 │
└───────────────────────────────┘      │ ⚠️ CEK MANUAL: B6              │
                                       │ [ Scan lagi ] [ Download CSV ] │
                                       └───────────────────────────────┘
```

- **Layar utama**
  - Pilihan ukuran 12,5 / 11,8 / 10,8 / 9,8 / **+**. Rentang toleransi ditampilkan dan terkunci.
  - Kolom catatan (opsional), ikut masuk ke CSV.
  - Tombol **SCAN** berupa `<input type="file" accept="image/*">` **tanpa** atribut `capture`. Operator bisa memotret langsung atau memilih foto dari galeri; pilihan galeri penting untuk PoC.
  - Ukuran dan catatan terakhir diingat di HP (localStorage).
  - **+ Tambah ukuran:** operator mengisi diameter nominal (mm), berupa angka 5–20 mm yang belum ada di daftar. Ukuran ini disimpan di HP itu saja, toleransinya otomatis ±0,20 mm, dan bisa dihapus lagi (untuk salah ketik). Ukuran bawaan tidak bisa dihapus.
- **Layar hasil**
  - Ringkasan besar: jumlah PASS / REJECT / CEK MANUAL, serta ukuran yang dipilih.
  - Foto asli dengan overlay: garis tepi yang ditemukan, ● hijau untuk PASS, ✗ merah untuk REJECT, ? oranye untuk CEK MANUAL, serta label A–J dan 1–10. Foto bisa di-zoom dengan dua jari.
  - Daftar cone yang tidak PASS (posisi dan diameter).
  - Ketuk sebuah cone untuk melihat detail: posisi, `d_kal`, min/maks, status, dan rentang terima.
  - Peringatan, misalnya salah pilih ukuran atau kualitas foto.
  - Tombol **Scan lagi** dan **Download CSV**.
- Bahasa Indonesia. Selain warna, selalu ada simbol atau teks, supaya tetap terbaca oleh operator yang buta warna.

**CSV:** satu baris per slot. Pemisah `;`, desimal `,`, dan UTF-8 dengan BOM, supaya langsung terbaca benar di Excel berbahasa Indonesia (akan dicek di Excel user saat PoC).

```
waktu;file_foto;catatan;ukuran;batas_bawah;batas_atas;posisi;diameter_mm;diameter_mentah_mm;diameter_min_mm;diameter_maks_mm;status;titik_valid;rms_mm;px_per_mm
```

Nama file: `scan_YYYY-MM-DD_HH-MM-SS_<ukuran>.csv`. Nilai `status` adalah `PASS`, `REJECT`, atau `CEK_MANUAL`.

## 7. Konfigurasi (`config.js`)

Satu file yang sama untuk semua HP, diperbarui lewat deploy:

- `sizesMm: [12.5, 11.8, 10.8, 9.8]`
- `toleranceMm: 0.2`, terkunci dan tidak bisa diubah dari app.
- `tray: { rows: 10, cols: 10, pitchColMm, pitchRowMm }`. Nilai pitch diisi dari pengukuran tray (persiapan PoC, langkah 2).
- `calibration: { a: 1, b: 0 }`, diganti dengan hasil PoC.
- Ambang kualitas dari bagian 5.

## 8. PoC

### Persiapan (dikerjakan user, ±3–4 jam)

1. Siapkan stand HP ±40 cm dan lampu.
2. Ukur jarak lubang tray, untuk satu baris dan satu kolom.
3. Siapkan sampel utama: **30 cone 12,5 mm** yang diberi nomor.
   - Sekitar 5 cone di masing-masing kisaran 12,3 / 12,4 / 12,5 / 12,6 / 12,7.
   - Beberapa cone < 12,3, beberapa > 12,7, dan beberapa yang oval.
4. Ukur setiap cone dengan gauge **3 kali**, idealnya oleh 2 operator. Catat juga skala terkecil pada gauge.
5. Untuk ukuran lain (11,8 / 10,8 / 9,8), siapkan masing-masing sekitar 10 cone dan ukur dengan gauge 3 kali.
6. Slot yang tidak dipakai sampel tetap diisi cone lain, supaya tray penuh seperti di produksi.

### Format data

- `poc/gauge.csv`: `cone_id;ukuran;gauge_1;gauge_2;gauge_3;operator`
- `poc/layout_<nama>.csv`: `posisi;cone_id`, yaitu posisi setiap sampel di tray untuk satu susunan.
- Kolom catatan di app diisi dengan format `layout=<nama> hp=<model> lampu=<n> uji=<n>`. Format ini dibaca oleh `tools/report.js`.
- Foto asli dari galeri disalin ke `samples/`.

### Uji

| Uji | Caranya | Pertanyaan yang dijawab |
|---|---|---|
| 1. Lampu | Coba 2–3 variasi lampu, masing-masing discan 3 kali | Lampu mana yang paling stabil dan paling sedikit menghasilkan CEK MANUAL? Lampu terpilih dipakai untuk uji berikutnya. |
| 2. Scan ulang | Tray yang sama discan 5 kali tanpa disentuh | Seberapa stabil kamera dan algoritmanya? |
| 3. Cabut-pasang | 30 sampel dicabut lalu dimasukkan lagi ke lubang yang sama, 3 kali, dan discan setiap kali | Apakah tray yang sekarang cukup konsisten? |
| 4. Pindah posisi | 30 sampel dipindah antara lubang tengah dan pinggir, lalu discan | Apakah posisi di tray memengaruhi hasil? |
| 5. Beda HP | Uji 2 diulang dengan 2–3 model HP | Apakah hasil antar HP sama? |
| 6. Ukuran lain | Sekitar 10 cone per ukuran discan | Apakah satu kalibrasi berlaku untuk semua ukuran? |

### Kriteria lolos

Kalibrasi (a, b) dihitung dari uji 2 dengan HP pertama, memakai rata-rata 5 scan per cone. Kriteria 2 dan 3 dicek pada data yang **tidak** dipakai untuk kalibrasi (uji 3–5).

1. **Pengulangan:** selisih setiap scan terhadap rata-rata cone tersebut ≤ 0,03 mm untuk ≥ 95% pengukuran (uji 2 dan 3).
2. **Akurasi:** selisih kamera terhadap rata-rata gauge ≤ 0,05 mm untuk ≥ 95% cone.
3. **Keputusan:** PASS/REJECT sama dengan gauge untuk semua cone yang rata-rata gauge-nya berjarak lebih dari 0,05 mm dari batas.
4. **Antar HP dan posisi:** selisih rata-rata setiap HP terhadap HP pertama ≤ 0,02 mm (uji 5), dan selisih rata-rata posisi tengah vs pinggir ≤ 0,02 mm (uji 4).
5. **CEK MANUAL:** ≤ 2 per 100 cone pada setiap scan tray penuh.
6. **Waktu:** ≤ 3 detik di setiap HP yang diuji.

Uji 6 dianggap lolos kalau kriteria 2 juga terpenuhi untuk ukuran lain dengan kalibrasi yang sama. Kalau tidak, dibuat kalibrasi per ukuran.

Kalau pengukuran ulang gauge sendiri berselisih lebih dari 0,05 mm (2×SD), ambang kriteria 2 ditinjau bersama berdasarkan data. Kamera tidak dinilai lebih teliti daripada patokannya.

### Jika tidak lolos

| Masalah | Perbaikan |
|---|---|
| Tepi tidak jelas atau banyak CEK MANUAL | Atur lampu, lalu perbaiki algoritma |
| Pengaruh posisi (uji 4) | Tambahkan koreksi distorsi lensa pada fit grid |
| Hasil cabut-pasang tidak konsisten (uji 3) | Modifikasi tray: lubang longgar + dasar rata |
| Beda antar HP (uji 5) | Tambahkan cone acuan (ukuran diketahui, selalu ikut difoto) untuk koreksi per foto |
| Kalibrasi beda per ukuran (uji 6) | Kalibrasi per ukuran di `config.js` |
| Semua perbaikan di atas tidak cukup | Kamera khusus (opsi C di brief awal) |

## 9. Pengujian kode

- Memakai `node --test`, tanpa framework.
- **Gambar buatan** dibuat oleh kode uji: grid 10×10 lingkaran gelap berukuran pasti di latar terang, dengan anti-aliasing, blur, dan noise. Ada juga varian oval dan varian perspektif (HP miring). Yang harus lolos:
  - Diameter terukur sama dengan diameter sebenarnya, selisih ≤ 0,01 mm pada resolusi ≥ 8 px/mm.
  - Untuk oval: `d_rata` ≈ (sumbu panjang + sumbu pendek)/2, dan `d_min`/`d_maks` mendekati kedua sumbu.
  - Varian perspektif tetap memberi hasil benar setelah homografi.
  - A1 berada di kiri atas, dan slot kosong berstatus CEK MANUAL.
  - Batas status untuk nominal 12,5: 12,30 dan 12,70 → PASS; 12,29 dan 12,71 → REJECT.
  - Peringatan salah pilih ukuran muncul saat seharusnya.
- **Uji format CSV:** pemisah dan desimal koma.
- **Setelah foto asli dan data gauge tersedia:** foto di `samples/` dijadikan uji regresi, supaya hasil tidak bergeser tanpa sengaja. Uji ini memakai decoder JPEG khusus uji (dependensi dev saja).
- **`tools/report.js`:** menghitung a dan b, lalu mengecek 6 kriteria PoC dari folder `poc/`.
- **Cek manual:** di browser PC dan minimal 1 HP Android, ditambah 1 iPhone kalau ada.

## 10. Di luar lingkup tahap 1

| Fitur | Kapan |
|---|---|
| Bingkai bidik live + foto otomatis (lihat catatan di bawah) | Tahap 2, setelah PoC lolos |
| Simpan hasil ke Supabase (hasil saja, bukan foto) | Setelah PoC lolos |
| Login, data operator, nomor lot, riwayat scan | Bersamaan dengan penyimpanan pusat |
| Mode offline | Kalau sinyal di lantai produksi jadi masalah |
| Pemrosesan di server (opsi B) | Kalau HP operator terlalu lambat |
| Kalibrasi per ukuran, cone acuan, koreksi distorsi | Hanya kalau data PoC menunjukkan perlu |

**Catatan tahap 2 (bingkai bidik):**
- 🔴 Merah: tidak ada cone terdeteksi.
- 🟡 Kuning: sebagian cone terdeteksi. Tampilkan jumlahnya (misalnya "87/100") dan tandai slot yang belum terdeteksi. Tombol "Scan sekarang" tetap tersedia.
- 🟢 Hijau: 100 cone terdeteksi, grid cocok, foto tajam, dan kamera diam ±1 detik. App lalu memotret dan mengukur otomatis.
- Selalu tampilkan angka dan ikon, bukan warna saja.
- Pilihan antara foto resolusi penuh dari tampilan live (Android) atau pengukuran langsung dari video ditentukan dari data PoC: foto sampel diperkecil ke resolusi video, lalu dicek apakah akurasinya masih memenuhi kriteria.

## 11. Risiko dan asumsi

| Risiko / asumsi | Dicek lewat | Cadangan |
|---|---|---|
| Tepi bukaan putih di atas karton putih kurang kontras (risiko terbesar) | Foto sampel, uji 1 | Variasi lampu, algoritma |
| Cone yang dimasukkan ulang duduk di tinggi yang sama | Uji 3 | Modifikasi tray |
| Beda pengolahan gambar antar HP | Uji 5 | Cone acuan |
| Distorsi lensa | Uji 4 | Koreksi distorsi |
| Gauge sendiri kurang konsisten | Pengukuran gauge 3 kali | Tinjau ulang kriteria 2 |
| Jarak lubang tray seragam | Pengukuran tray | Ukur beberapa baris dan kolom |
| Batas memori canvas di iPhone | Cek manual di iPhone | Perkecil foto > 16 MP |
| Format CSV di Excel user | Buka CSV di Excel user | Ganti pemisah atau desimal |
