import { describe, expect, it } from 'vitest';
import {
  applyLinuxAutostart,
  autostartFilePath,
  desktopEntry,
  execLine,
} from '../src/main/autostart.js';

describe('execLine', () => {
  it('relaunches the .AppImage itself, not the mounted squashfs binary', () => {
    // execPath points inside the AppImage mount, which is gone after quit
    expect(
      execLine({
        isPackaged: true,
        execPath: '/tmp/.mount_x/claude-manager',
        appImage: '/home/u/Apps/Claude Manager.AppImage',
      }),
    ).toBe('"/home/u/Apps/Claude Manager.AppImage" --no-sandbox');
  });

  it('relaunches the installed binary on deb/rpm builds', () => {
    expect(execLine({ isPackaged: true, execPath: '/opt/Claude Manager/claude-manager' })).toBe(
      '"/opt/Claude Manager/claude-manager" --no-sandbox',
    );
  });

  it('keeps a dev run bootable: electron binary plus the app dir', () => {
    expect(
      execLine({ isPackaged: false, execPath: '/repo/node_modules/electron/dist/electron', appDir: '/repo' }),
    ).toBe('"/repo/node_modules/electron/dist/electron" "/repo" --no-sandbox');
  });
});

describe('desktopEntry', () => {
  const entry = desktopEntry({ execLine: '"/opt/x/claude-manager" --no-sandbox', iconPath: '/opt/x/icon.png' });

  it('boots the given command at login', () => {
    expect(entry).toContain('Exec="/opt/x/claude-manager" --no-sandbox');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
    expect(entry).toContain('Type=Application');
  });

  it('lets the desktop match the running window to the entry', () => {
    expect(entry).toContain('StartupWMClass=vizor');
    expect(entry).toContain('Icon=/opt/x/icon.png');
  });
});

describe('applyLinuxAutostart', () => {
  const fakeFs = () => {
    const calls = [];
    return {
      calls,
      mkdirSync: (dir, opts) => calls.push(['mkdir', dir, opts]),
      writeFileSync: (file, content) => calls.push(['write', file, content]),
      rmSync: (file, opts) => calls.push(['rm', file, opts]),
    };
  };

  it('writes the entry into ~/.config/autostart when enabling', () => {
    const fsApi = fakeFs();
    applyLinuxAutostart(true, { entry: 'ENTRY', file: '/home/u/.config/autostart/cm.desktop', fsApi });
    expect(fsApi.calls).toEqual([
      ['mkdir', '/home/u/.config/autostart', { recursive: true }],
      ['write', '/home/u/.config/autostart/cm.desktop', 'ENTRY'],
    ]);
  });

  it('removes the entry when disabling, tolerating an absent file', () => {
    const fsApi = fakeFs();
    applyLinuxAutostart(false, { entry: 'ENTRY', file: '/home/u/.config/autostart/cm.desktop', fsApi });
    expect(fsApi.calls).toEqual([['rm', '/home/u/.config/autostart/cm.desktop', { force: true }]]);
  });
});

describe('autostartFilePath', () => {
  it('lives in the user autostart dir under the app name', () => {
    expect(autostartFilePath('/home/u')).toBe('/home/u/.config/autostart/vizor.desktop');
  });
});
