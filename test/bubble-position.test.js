import { describe, expect, it } from 'vitest';
import { anchorVisible, centerAnchor } from '../src/main/bubble-position.js';

const BOX = 56;
const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const second = { workArea: { x: 1920, y: 0, width: 1280, height: 984 } };

describe('anchorVisible', () => {
  it('accepts an anchor whose whole box sits inside a display', () => {
    expect(anchorVisible({ x: 100, y: 100 }, [primary], BOX)).toBe(true);
  });

  it('accepts an anchor on a secondary display', () => {
    expect(anchorVisible({ x: 2000, y: 40 }, [primary, second], BOX)).toBe(true);
  });

  it('rejects an anchor left behind by an unplugged display', () => {
    // saved while the second monitor existed, loaded after it was removed
    expect(anchorVisible({ x: 2000, y: 40 }, [primary], BOX)).toBe(false);
  });

  it('rejects an anchor whose box only partially enters the screen', () => {
    expect(anchorVisible({ x: 1920 - BOX + 1, y: 100 }, [primary], BOX)).toBe(false);
    expect(anchorVisible({ x: -1, y: 100 }, [primary], BOX)).toBe(false);
  });

  it('rejects a missing or malformed anchor', () => {
    expect(anchorVisible(null, [primary], BOX)).toBe(false);
    expect(anchorVisible({ x: 'NaN' }, [primary], BOX)).toBe(false);
  });
});

describe('centerAnchor', () => {
  it('centers the box on the given work area', () => {
    expect(centerAnchor(primary.workArea, BOX)).toEqual({ x: 932, y: 492 });
  });

  it('respects the work area origin of a secondary display', () => {
    expect(centerAnchor(second.workArea, BOX)).toEqual({ x: 2532, y: 464 });
  });
});

describe('spotlightBounds', () => {
  it('centers the halo window on the bubble', async () => {
    const { spotlightBounds } = await import('../src/main/bubble-position.js');
    expect(spotlightBounds({ x: 100, y: 200 }, 56, 160)).toEqual({
      x: 48,
      y: 148,
      width: 160,
      height: 160,
    });
  });
});
