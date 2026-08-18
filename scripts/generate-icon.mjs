#!/usr/bin/env node
// Generates assets/icon.png (512x512) — the Claude Manager spark on an
// orange gradient circle — with zero external dependencies (raw PNG chunks).
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const CENTER = SIZE / 2;
const CIRCLE_RADIUS = 236;
const STAR_RADIUS = 150;

// --- scene ---------------------------------------------------------------

const GRADIENT_TOP = [232, 148, 106]; // #e8946a
const GRADIENT_MID = [217, 119, 87]; // #d97757
const GRADIENT_BOTTOM = [180, 83, 9]; // #b45309

function circleGradientColor(x, y) {
  // light from the top-left, like the bubble's radial gradient
  const t = Math.min(1, Math.max(0, (x + y) / (2 * SIZE)));
  const mix = (a, b, f) => Math.round(a + (b - a) * f);
  const [top, mid, bottom] = [GRADIENT_TOP, GRADIENT_MID, GRADIENT_BOTTOM];
  if (t < 0.5) {
    const f = t / 0.5;
    return [mix(top[0], mid[0], f), mix(top[1], mid[1], f), mix(top[2], mid[2], f)];
  }
  const f = (t - 0.5) / 0.5;
  return [mix(mid[0], bottom[0], f), mix(mid[1], bottom[1], f), mix(mid[2], bottom[2], f)];
}

function insideCircle(x, y) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  return dx * dx + dy * dy <= CIRCLE_RADIUS * CIRCLE_RADIUS;
}

// 4-point star (astroid): |x|^(2/3) + |y|^(2/3) <= r^(2/3)
function insideStar(x, y) {
  const dx = Math.abs(x - CENTER);
  const dy = Math.abs(y - CENTER);
  const exponent = 2 / 3;
  return dx ** exponent + dy ** exponent <= STAR_RADIUS ** exponent;
}

function pixel(x, y) {
  // 3x3 subsampling for antialiased edges
  let circleHits = 0;
  let starHits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      if (insideCircle(px, py)) {
        circleHits++;
        if (insideStar(px, py)) starHits++;
      }
    }
  }
  if (!circleHits) return [0, 0, 0, 0];
  const [r, g, b] = circleGradientColor(x, y);
  const starFraction = starHits / circleHits;
  const blend = (channel) => Math.round(channel + (255 - channel) * starFraction);
  return [blend(r), blend(g), blend(b), Math.round((circleHits / 9) * 255)];
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
