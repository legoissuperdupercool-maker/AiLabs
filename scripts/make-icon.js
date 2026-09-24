// Generates build/icon.png (256x256) — a pixel-art agent on a gradient tile.
// electron-builder turns it into the Windows .ico for the app and installer.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4);

function set(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const sa = a / 255;
  px[i] = Math.round(r * sa + px[i] * (1 - sa));
  px[i + 1] = Math.round(g * sa + px[i + 1] * (1 - sa));
  px[i + 2] = Math.round(b * sa + px[i + 2] * (1 - sa));
  px[i + 3] = Math.max(px[i + 3], a);
}

// rounded gradient tile
const R = 52;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = Math.min(Math.max(x, R), S - 1 - R);
    const cy = Math.min(Math.max(y, R), S - 1 - R);
    const d = Math.hypot(x - cx, y - cy);
    if (d > R) continue;
    const t = (x + y) / (2 * S);
    const a = d > R - 1 ? Math.round(255 * (R - d)) : 255;
    set(x, y, [Math.round(0x6d + (0xc8 - 0x6d) * t), Math.round(0x7d + (0x6b - 0x7d) * t), 0xff, a]);
  }
}

// pixel character (16x16 grid, 11px cells)
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = { H: hex('#2b1d14'), S: hex('#f6d3b3'), E: hex('#1b1b26'), B: hex('#4dd0e1'), D: hex('#2a8fa0'), W: hex('#ffffff'), K: hex('#1d2233') };
const art = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....SSSSSSSS....',
  '....SSESSESS....',
  '....SSESSESS....',
  '....SSSSSSSS....',
  '.....SSSSSS.....',
  '...BBBBWWBBBB...',
  '..BBBBBWWBBBBB..',
  '..SBBBBBBBBBBS..',
  '..SBBBBBBBBBBS..',
  '....DDDDDDDD....',
  '....KKK..KKK....',
  '................',
];
const cell = 11;
const ox = Math.floor((S - 16 * cell) / 2);
const oy = Math.floor((S - 16 * cell) / 2) + 6;
// soft shadow
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
  if (art[y][x] === '.') continue;
  for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) set(ox + x * cell + i + 5, oy + y * cell + j + 6, [20, 10, 60, 70]);
}
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
  const c = C[art[y][x]];
  if (!c) continue;
  for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) set(ox + x * cell + i, oy + y * cell + j, c);
}

// PNG encode
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), png);
console.log('wrote build/icon.png');
