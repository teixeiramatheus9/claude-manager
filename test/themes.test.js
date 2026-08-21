import { describe, it, expect } from 'vitest';
import {
  THEMES,
  PALETTES,
  DEFAULT_THEME,
  DEFAULT_PALETTE,
  migrateThemeConfig,
} from '../src/main/themes.js';

describe('themes', () => {
  it('ships the classic and arcade skins', () => {
    expect(THEMES.classico).toBeDefined();
    expect(THEMES.arcade).toBeDefined();
  });

  it('defaults to a theme and a palette that exist', () => {
    expect(THEMES[DEFAULT_THEME]).toBeDefined();
    expect(PALETTES[DEFAULT_PALETTE]).toBeDefined();
  });

  it('gives every theme and palette a label for the settings dropdowns', () => {
    for (const [value, spec] of Object.entries({ ...THEMES, ...PALETTES })) {
      expect(spec.label, `entry ${value}`).toBeTypeOf('string');
      expect(spec.label.length, `entry ${value}`).toBeGreaterThan(0);
    }
  });

  it('keeps the pip-boy phosphor palette', () => {
    expect(PALETTES.pipboy).toBeDefined();
  });
});

describe('migrateThemeConfig', () => {
  it('moves a pre-skin colour theme into the palette field of the classic skin', () => {
    const migrated = migrateThemeConfig({ theme: 'magenta', crt: true });
    expect(migrated.theme).toBe('classico');
    expect(migrated.palette).toBe('magenta');
    expect(migrated.crt).toBe(true);
  });

  it('passes a new-style config through untouched', () => {
    const config = { theme: 'arcade', palette: 'ciano' };
    expect(migrateThemeConfig(config)).toEqual(config);
  });

  it('falls back to defaults when the stored theme is unknown', () => {
    const migrated = migrateThemeConfig({ theme: 'vaporwave', palette: 'giz' });
    expect(migrated.theme).toBe(DEFAULT_THEME);
    expect(migrated.palette).toBe('giz');
  });

  it('normalizes an unknown palette instead of letting it linger', () => {
    const migrated = migrateThemeConfig({ theme: 'classico', palette: 'plasma' });
    expect(migrated.palette).toBe(DEFAULT_PALETTE);
  });
});
