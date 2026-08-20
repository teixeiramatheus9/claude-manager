import { describe, expect, it } from 'vitest';
import { legacyConfigDir, legacyAutostartFile, migrateLegacyInstall } from '../src/main/migration.js';

const fakeFs = (existing = []) => {
  const calls = [];
  return {
    calls,
    existsSync: (p) => existing.includes(p),
    renameSync: (from, to) => calls.push(['rename', from, to]),
    rmSync: (p, opts) => calls.push(['rm', p, opts]),
    mkdirSync: (p, opts) => calls.push(['mkdir', p, opts]),
  };
};

describe('legacy paths', () => {
  it('points at the old install identity', () => {
    expect(legacyConfigDir('/home/u')).toBe('/home/u/.config/claude-manager');
    expect(legacyAutostartFile('/home/u')).toBe(
      '/home/u/.config/autostart/claude-manager.desktop',
    );
  });
});

describe('migrateLegacyInstall', () => {
  const dirs = {
    legacyDir: '/h/.config/claude-manager',
    targetDir: '/h/.config/vizor',
    legacyAutostart: '/h/.config/autostart/claude-manager.desktop',
  };

  it('carries the whole old config dir over — position, sessions, voices', () => {
    const fsApi = fakeFs([dirs.legacyDir]);
    const result = migrateLegacyInstall({ ...dirs, fsApi, enableAutostart: () => {} });
    expect(result.migratedConfig).toBe(true);
    expect(fsApi.calls).toContainEqual(['mkdir', '/h/.config', { recursive: true }]);
    expect(fsApi.calls).toContainEqual(['rename', dirs.legacyDir, dirs.targetDir]);
  });

  it('never touches an existing vizor dir — the migration runs once', () => {
    const fsApi = fakeFs([dirs.legacyDir, dirs.targetDir]);
    const result = migrateLegacyInstall({ ...dirs, fsApi, enableAutostart: () => {} });
    expect(result.migratedConfig).toBe(false);
    expect(fsApi.calls.filter(([op]) => op === 'rename')).toHaveLength(0);
  });

  it('does nothing on a fresh machine', () => {
    const fsApi = fakeFs([]);
    const result = migrateLegacyInstall({ ...dirs, fsApi, enableAutostart: () => {} });
    expect(result.migratedConfig).toBe(false);
    expect(result.migratedAutostart).toBe(false);
    expect(fsApi.calls).toEqual([]);
  });

  it('re-enables autostart under the new name and removes the old entry', () => {
    const fsApi = fakeFs([dirs.legacyAutostart]);
    let enabled = false;
    const result = migrateLegacyInstall({ ...dirs, fsApi, enableAutostart: () => (enabled = true) });
    expect(result.migratedAutostart).toBe(true);
    expect(enabled).toBe(true);
    expect(fsApi.calls).toContainEqual(['rm', dirs.legacyAutostart, { force: true }]);
  });

  it('survives a half-broken filesystem without throwing', () => {
    const fsApi = fakeFs([dirs.legacyDir]);
    fsApi.renameSync = () => {
      throw new Error('EXDEV');
    };
    const log = [];
    const result = migrateLegacyInstall({
      ...dirs,
      fsApi,
      enableAutostart: () => {},
      log: (line) => log.push(line),
    });
    expect(result.migratedConfig).toBe(false);
    expect(log.length).toBeGreaterThan(0);
  });
});
