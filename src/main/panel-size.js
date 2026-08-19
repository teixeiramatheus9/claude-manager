export const PANEL_SCALE = { min: 80, max: 160, step: 10, default: 100 };

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function clampScale(scale) {
  const rounded = Math.round(Number(scale) / PANEL_SCALE.step) * PANEL_SCALE.step;
  return clamp(Number.isFinite(rounded) ? rounded : PANEL_SCALE.default, PANEL_SCALE.min, PANEL_SCALE.max);
}

// The window grows with the same factor the contents are zoomed by, so the
// panel keeps its proportions and the text just gets bigger.
export function panelSizeForScale(scale, base, workArea = null) {
  const factor = clampScale(scale) / 100;
  const size = { width: Math.round(base.width * factor), height: Math.round(base.height * factor) };
  if (!workArea) return size;
  return {
    width: Math.min(size.width, workArea.width),
    height: Math.min(size.height, workArea.height),
  };
}
