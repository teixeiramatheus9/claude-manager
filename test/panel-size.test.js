import { describe, expect, it } from 'vitest';
import { PANEL_SCALE, clampScale, panelSizeForScale } from '../src/main/panel-size.js';

const base = { width: 436, height: 552 };

describe('clampScale', () => {
  it('snaps to the step and stays inside the range', () => {
    expect(clampScale(103)).toBe(100);
    expect(clampScale(1000)).toBe(PANEL_SCALE.max);
    expect(clampScale(10)).toBe(PANEL_SCALE.min);
    expect(clampScale('nada')).toBe(PANEL_SCALE.default);
  });
});

describe('panelSizeForScale', () => {
  it('scales both sides by the same factor', () => {
    expect(panelSizeForScale(150, base)).toEqual({ width: 654, height: 828 });
    expect(panelSizeForScale(100, base)).toEqual(base);
  });

  it('never grows past the screen', () => {
    const workArea = { width: 500, height: 600 };
    expect(panelSizeForScale(160, base, workArea)).toEqual({ width: 500, height: 600 });
  });
});
