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
// The panel draws its own background and shows the icon small, so the tray
// variant is the bare glyph on transparency — a dark tile there reads as a
// black smudge next to every other status icon.
const TRAY_SIZE = 64;

// --- scene ---------------------------------------------------------------

// Same tokens as the monochrome theme (the default one), so the launcher icon
// and the bubble read as the same product.
const SURFACE = [17, 18, 19]; // #111213
const BORDER_COLOR = [39, 41, 43]; // #27292B
const ACCENT = [231, 237, 243]; // #E7EDF3

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

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Same 11x11 grid as the app icon, scaled to the tray size and drawn in the
// accent alone so the panel's own background shows through. A panel renders
// this at 16-22px, where the loose 2x2 marks read as scattered dots — so the
// tray variant fattens each mark by half a unit per side, which joins the
// chevron into one stroke while keeping the same glyph.
const TRAY_BOLD = 0.5;

function trayPixel(x, y) {
  const unit = TRAY_SIZE / GRID;
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const gx = (x + (sx + 0.5) / 3) / unit;
      const gy = (y + (sy + 0.5) / 3) / unit;
      if (
        MARKS.some(
          ([mx, my, mw, mh]) =>
            gx >= mx - TRAY_BOLD &&
            gx < mx + mw + TRAY_BOLD &&
            gy >= my - TRAY_BOLD &&
            gy < my + mh + TRAY_BOLD,
        )
      ) {
        hits++;
      }
    }
  }
  return [...ACCENT, Math.round((hits / 9) * 255)];
}

const outputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = path.join(outputDir, 'icon.png');
const png = encodePng(SIZE, pixel);
const trayFile = path.join(outputDir, 'tray-icon.png');
fs.writeFileSync(trayFile, encodePng(TRAY_SIZE, trayPixel));
console.log(`Wrote ${trayFile} (${TRAY_SIZE}x${TRAY_SIZE})`);
fs.writeFileSync(outputFile, png);
console.log(`Wrote ${outputFile} (${png.length} bytes)`);
