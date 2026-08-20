import { describe, it, expect } from 'vitest';
import { buildDesktopEntry, buildRunRegistryCommand } from '../scripts/install-autostart.js';

describe('buildRunRegistryCommand', () => {
  it('adds the HKCU Run value', () => {
    expect(
      buildRunRegistryCommand({
        electronBinary: 'C:\\app\\node_modules\\electron\\dist\\electron.exe',
        appDir: 'C:\\app',
      }),
    ).toEqual([
      'reg',
      [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v',
        'ClaudeManager',
        '/t',
        'REG_SZ',
        '/d',
        '"C:\\app\\node_modules\\electron\\dist\\electron.exe" "C:\\app"',
        '/f',
      ],
    ]);
  });

  it('removes the value with --remove', () => {
    expect(buildRunRegistryCommand({ electronBinary: 'x', appDir: 'y', remove: true })).toEqual([
      'reg',
      ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'ClaudeManager', '/f'],
    ]);
  });
});

describe('buildDesktopEntry', () => {
  it('quotes paths with spaces and disables the sandbox', () => {
    const entry = buildDesktopEntry({
      electronBinary: '/home/user/Claude Manager/node_modules/electron/dist/electron',
      appDir: '/home/user/Claude Manager',
      iconPath: '/home/user/Claude Manager/assets/icon.png',
    });
    expect(entry).toContain(
      'Exec="/home/user/Claude Manager/node_modules/electron/dist/electron" "/home/user/Claude Manager" --no-sandbox',
    );
    expect(entry).toContain('[Desktop Entry]');
    expect(entry).toContain('Type=Application');
    expect(entry).toContain('Icon=/home/user/Claude Manager/assets/icon.png');
    expect(entry).toContain('StartupWMClass=vizor');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
  });
});
