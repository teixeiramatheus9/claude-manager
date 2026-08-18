import { describe, it, expect } from 'vitest';
import { buildDesktopEntry } from '../scripts/install-autostart.js';

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
    expect(entry).toContain('StartupWMClass=claude-manager');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
  });
});
