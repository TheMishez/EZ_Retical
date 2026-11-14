// Generates build/icon.png (256x256) with no dependencies: node tools/make-icon.js
const fs = require('fs');
const zlib = require('zlib');
const N = 256;
const buf = Buffer.alloc(N * N * 4);
const c = (N - 1) / 2;
function put(x, y, r, g, b, a) { const i = (y * N + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a; }
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = x - c, dy = y - c;
    // rounded square background
    const m = 56, rad = 52;
    const qx = Math.max(Math.abs(dx) - (N / 2 - m + rad - 8), 0), qy = Math.max(Math.abs(dy) - (N / 2 - m + rad - 8), 0);
    const inside = Math.hypot(qx, qy) <= rad + 8 && Math.abs(dx) <= N / 2 - 8 && Math.abs(dy) <= N / 2 - 8;
    if (!inside) { put(x, y, 0, 0, 0, 0); continue; }
    const t = y / N;
    let R = 20 + 10 * t, G = 24 + 12 * t, B = 32 + 14 * t, A = 255;
    const d = Math.hypot(dx, dy);
    const ring = Math.abs(d - 74) < 7;
    const arm = (Math.abs(dx) < 7 || Math.abs(dy) < 7) && d < 108 && d > 34;
    const dot = d < 9;
    if (ring || arm || dot) { R = 61; G = 220; B = 132; }
    put(x, y, R | 0, G | 0, B | 0, A);
  }
}
function crc(b) { let c2 = ~0; for (const v of b) { c2 ^= v; for (let k = 0; k < 8; k++) c2 = (c2 >>> 1) ^ (0xedb88320 & -(c2 & 1)); } return ~c2 >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); }
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; buf.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote build/icon.png');
