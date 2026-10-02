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
