// Kept free of electron imports on purpose: the decisions are testable here
// and index.js does the screen/window wiring.

// The saved anchor can point at a display that no longer exists (unplugged
// monitor, resolution change). Trusting the file would boot the bubble off
// screen with no way to grab it, so the anchor only counts when its whole box
// fits inside some current display.
export function anchorVisible(anchor, displays, box) {
  if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) return false;
  return displays.some(
    ({ workArea }) =>
      anchor.x >= workArea.x &&
      anchor.x + box <= workArea.x + workArea.width &&
      anchor.y >= workArea.y &&
      anchor.y + box <= workArea.y + workArea.height,
  );
}

export function centerAnchor(workArea, box) {
  return {
    x: workArea.x + Math.round((workArea.width - box) / 2),
    y: workArea.y + Math.round((workArea.height - box) / 2),
  };
}
