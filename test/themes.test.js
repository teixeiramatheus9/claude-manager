import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME } from '../src/main/themes.js';

describe('themes', () => {
  it('defaults to a theme that exists', () => {
    expect(THEMES[DEFAULT_THEME]).toBeDefined();
  });

  it('gives every theme a label for the settings dropdown', () => {
    for (const [value, spec] of Object.entries(THEMES)) {
      expect(spec.label, `theme ${value}`).toBeTypeOf('string');
      expect(spec.label.length, `theme ${value}`).toBeGreaterThan(0);
    }
  });

  it('ships the pip-boy phosphor theme', () => {
    expect(THEMES.pipboy).toBeDefined();
  });
});
