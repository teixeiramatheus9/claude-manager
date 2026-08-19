import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../src/main/version-utils.js';

describe('isNewerVersion', () => {
  it('compares major, minor and patch in order', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.2.9')).toBe(true);
    expect(isNewerVersion('0.2.10', '0.2.9')).toBe(true);
    expect(isNewerVersion('0.2.9', '0.2.10')).toBe(false);
  });

  it('treats equal versions as not newer and tolerates the v prefix', () => {
    expect(isNewerVersion('v0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('v0.2.1', 'v0.2.0')).toBe(true);
  });

  it('handles garbage gracefully', () => {
    expect(isNewerVersion(undefined, '0.2.0')).toBe(false);
    expect(isNewerVersion('1.0.0', null)).toBe(true);
  });
});
