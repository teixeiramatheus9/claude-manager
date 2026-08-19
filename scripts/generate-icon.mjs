#!/usr/bin/env node
// Generates assets/icon.png (512x512) — the pixel prompt on a graphite tile —
// with zero external dependencies (raw PNG chunks).
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const MARGIN = 16;
const CORNER = 112; // macOS-ish superellipse radius
const BORDER = 4;

// --- scene ---------------------------------------------------------------

const SURFACE = [13, 17, 23]; // #0D1117
const BORDER_COLOR = [31, 39, 51]; // #1F2733
const ACCENT = [122, 162, 247]; // #7AA2F7

// Same 11x11 grid as the logo in the app: chevron plus a cursor block.
const GRID = 11;
const MARKS = [
  [1, 1, 2, 2],
  [3, 3, 2, 2],
  [5, 5, 2, 2],
  [3, 7, 2, 2],
  [1, 9, 2, 2],
  [8, 9, 3, 2],
];
const GRID_PX = 300;
const GRID_ORIGIN = (SIZE - GRID_PX) / 2;
const UNIT = GRID_PX / GRID;

function insideRoundedSquare(x, y, inset) {
  const min = MARGIN + inset;
  const max = SIZE - MARGIN - inset;
  const radius = CORNER - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideMark(x, y) {
  const gx = (x - GRID_ORIGIN) / UNIT;
  const gy = (y - GRID_ORIGIN) / UNIT;
  return MARKS.some(([mx, my, mw, mh]) => gx >= mx && gx < mx + mw && gy >= my && gy < my + mh);
}

function pixel(x, y) {
  // 3x3 subsampling for antialiased edges
  let tileHits = 0;
  let innerHits = 0;
  let markHits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      if (!insideRoundedSquare(px, py, 0)) continue;
      tileHits++;
      if (insideRoundedSquare(px, py, BORDER)) innerHits++;
      if (insideMark(px, py)) markHits++;
    }
  }
  if (!tileHits) return [0, 0, 0, 0];
  const mix = (a, b, f) => Math.round(a + (b - a) * f);
  const borderFraction = 1 - innerHits / tileHits;
  const markFraction = markHits / tileHits;
  const base = SURFACE.map((channel, i) => mix(channel, BORDER_COLOR[i], borderFraction));
  const rgb = base.map((channel, i) => mix(channel, ACCENT[i], markFraction));
  return [...rgb, Math.round((tileHits / 9) * 255)];
}

// --- png encoding --------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y);
    const offset = rowStart + 1 + x * 4;
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = path.join(outputDir, 'icon.png');
fs.writeFileSync(outputFile, png);
console.log(`Wrote ${outputFile} (${png.length} bytes)`);
