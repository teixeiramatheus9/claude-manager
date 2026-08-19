import { describe, it, expect } from 'vitest';
import { pickPackageAsset } from '../src/main/update-assets.js';

const assets = [
  { name: 'Claude-Manager-0.3.0.AppImage' },
  { name: 'claude-manager_0.3.0_amd64.deb' },
  { name: 'claude-manager-0.3.0.x86_64.rpm' },
  { name: 'claude-manager-0.3.0.aarch64.rpm' },
  { name: 'Claude-Manager-0.3.0-arm64.dmg' },
];

describe('pickPackageAsset', () => {
  it('picks the deb for x64', () => {
    expect(pickPackageAsset(assets, 'deb', 'x64').name).toBe('claude-manager_0.3.0_amd64.deb');
  });

  it('picks the rpm matching the architecture', () => {
    expect(pickPackageAsset(assets, 'rpm', 'x64').name).toBe('claude-manager-0.3.0.x86_64.rpm');
    expect(pickPackageAsset(assets, 'rpm', 'arm64').name).toBe('claude-manager-0.3.0.aarch64.rpm');
  });

  it('falls back to any asset of the format when the arch token is absent', () => {
    const only = [{ name: 'claude-manager_0.3.0.deb' }];
    expect(pickPackageAsset(only, 'deb', 'x64').name).toBe('claude-manager_0.3.0.deb');
  });

  it('returns null when the format has no asset', () => {
    expect(pickPackageAsset(assets, 'deb', 'arm64')).not.toBeNull();
    expect(pickPackageAsset([{ name: 'x.AppImage' }], 'rpm')).toBeNull();
  });
});
