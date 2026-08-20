import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  fileURLToPath(new URL('../src/renderer/app.html', import.meta.url)),
  'utf8',
);

const css = html.replace(/\/\*[\s\S]*?\*\//g, '');

/** Selectors of every rule whose body applies the barrel filter. */
function barrelledSelectors() {
  const rules = [];
  const re = /([^{};]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css))) {
    if (/filter:\s*url\(#crt-barrel\)/.test(match[2])) {
      rules.push(...match[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')));
    }
  }
  return rules;
}

/** The barrel's <filter> element, attributes and children included. */
function barrelFilter() {
  return html.match(/<filter\b[^>]*id="crt-barrel"[\s\S]*?<\/filter>/)[0];
}

/** Just the <filter> opening tag, where the region is declared. */
function barrelFilterTag() {
  return barrelFilter().match(/<filter[^>]*>/)[0];
}

/** The displacement map, decoded back from the feImage data URI. */
function displacementMap() {
  const href = barrelFilter().match(/href="data:image\/svg\+xml,([^"]*)"/)[1];
  return decodeURIComponent(href);
}

describe('crt barrel filter', () => {
  // The filter displaces the surface's own outline, and a circle's contour runs
  // through the box interior at every angle: no box-aligned displacement field
  // can bulge the inside and leave the ring where it was. Measured on the 56px
  // bubble: the shipped map pulled the ring 1.75px inward all round, and an
  // edge-neutral map pushed it 1.4px out at the diagonals instead.
  it('stays off the bubble, whose outline is a circle', () => {
    expect(barrelledSelectors()).not.toContain('body.crt #bubble');
  });

  it('still curves the toast, whose outline is the box edge', () => {
    expect(barrelledSelectors()).toContain('body.crt #tooltip');
  });

  // Without this the region keeps its default 10% margin, the map is stretched
  // over a box wider than the surface, and the neutral ends land outside it.
  it('pins the filter region to the surface box', () => {
    const tag = barrelFilterTag();
    expect(tag).toMatch(/\sx="0%"/);
    expect(tag).toMatch(/\sy="0%"/);
    expect(tag).toMatch(/\swidth="100%"/);
    expect(tag).toMatch(/\sheight="100%"/);
  });

  // 0x80 in a channel is "do not move this pixel". Neutral at both ends of
  // each ramp means the surface's border keeps every pixel it had.
  it('leaves the surface edges undisplaced', () => {
    const map = displacementMap();
    const gradients = map.match(/<linearGradient[\s\S]*?<\/linearGradient>/g);
    expect(gradients).toHaveLength(2);
    for (const gradient of gradients) {
      const stops = [...gradient.matchAll(/offset='([\d.]+)'\s+stop-color='([^']+)'/g)];
      const first = stops.at(0);
      const last = stops.at(-1);
      expect(Number(first[1])).toBe(0);
      expect(Number(last[1])).toBe(1);
      expect(first[2]).toMatch(/^#(800000|008000)$/);
      expect(last[2]).toBe(first[2]);
    }
  });
});
