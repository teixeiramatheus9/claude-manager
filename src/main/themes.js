// Themes are whole skins: they change layout language, type and chrome.
// Palettes only swap the colour token set, and only the classic skin offers
// them — arcade carries its own fixed neon look.
export const THEMES = {
  classico: { label: 'clássico' },
  arcade: { label: 'arcade' },
};

export const PALETTES = {
  aco: { label: 'azul-aço' },
  ambar: { label: 'âmbar crt' },
  magenta: { label: 'magenta synth' },
  ciano: { label: 'ciano gelo' },
  mono: { label: 'monocromo escuro' },
  giz: { label: 'monocromo claro' },
  magma: { label: 'magma reator' },
  matrix: { label: 'matrix code' },
  pipboy: { label: 'pip-boy 3000' },
};

export const DEFAULT_THEME = 'classico';
export const DEFAULT_PALETTE = 'mono';

// Configs written before skins existed keep a palette name in `theme` — carry
// it over to the palette field and land on the classic skin. Unknown values
// (a removed palette, hand-edited json) normalize to the defaults instead of
// lingering and painting nothing.
export function migrateThemeConfig(config) {
  const migrated = { ...config };
  if (PALETTES[migrated.theme]) {
    migrated.palette = migrated.theme;
    migrated.theme = 'classico';
  } else if (!THEMES[migrated.theme]) {
    migrated.theme = DEFAULT_THEME;
  }
  if (!PALETTES[migrated.palette]) migrated.palette = DEFAULT_PALETTE;
  return migrated;
}
