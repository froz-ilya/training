// Draws the app icons as PNG files, with no dependencies: `npm run icons`.
// A saffron dumbbell on the ink background, the same colours as src/styles/app.css.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const INK = [13, 16, 23];
const SAFFRON = [246, 195, 91];
const SAMPLES = 4;

/** The dumbbell in a 1×1 box around the centre, as [half width, half height, x offset, radius]. */
const PARTS = [
  [0.34, 0.035, 0, 0.02], // bar
  [0.055, 0.2, -0.205, 0.04], // inner plates
  [0.055, 0.2, 0.205, 0.04],
  [0.04, 0.13, -0.315, 0.03], // outer plates
  [0.04, 0.13, 0.315, 0.03],
];

/** Signed distance to a rounded box: below zero is inside. */
function box(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius);
  const dy = Math.abs(y) - (halfH - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

function insideDumbbell(x, y) {
  return PARTS.some(([halfW, halfH, offset, radius]) => box(x - offset, y, halfW, halfH, radius) <= 0);
}

/** `scale` shrinks the dumbbell; `corner` rounds the background (0 = full bleed). */
function draw(size, { scale = 1, corner = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let ink = 0;
      let saffron = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size - 0.5;
          const y = (py + (sy + 0.5) / SAMPLES) / size - 0.5;
          if (corner && box(x, y, 0.5, 0.5, corner) > 0) continue;
          if (insideDumbbell(x / scale, y / scale)) saffron++;
          else ink++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const covered = ink + saffron;
      const at = (py * size + px) * 4;
      if (!covered) continue;
      for (let c = 0; c < 3; c++) rgba[at + c] = Math.round((INK[c] * ink + SAFFRON[c] * saffron) / covered);
      rgba[at + 3] = Math.round((covered / total) * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  // iOS rounds home-screen icons itself, so this one has no corners or transparency.
  { file: 'apple-touch-icon.png', size: 180, options: {} },
  { file: 'icon-192.png', size: 192, options: { corner: 0.2 } },
  { file: 'icon-512.png', size: 512, options: { corner: 0.2 } },
  // Maskable icons get cropped, so the dumbbell stays inside the safe circle.
  { file: 'icon-maskable-512.png', size: 512, options: { scale: 0.74 } },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, options } of ICONS) {
  writeFileSync(join(OUT, file), png(size, draw(size, options)));
  console.log(file);
}
