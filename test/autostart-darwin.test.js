import { describe, expect, it } from 'vitest';
import { buildLaunchAgentPlist } from '../scripts/install-autostart.js';

describe('buildLaunchAgentPlist', () => {
  it('points the launch agent at the electron binary and app dir', () => {
    const plist = buildLaunchAgentPlist({
      electronBinary: '/repo/node_modules/electron/dist/electron',
      appDir: '/repo',
    });
    expect(plist).toContain('<string>io.github.teixeiramatheus9.vizor</string>');
    expect(plist).toContain('<string>/repo/node_modules/electron/dist/electron</string>');
    expect(plist).toContain('<string>/repo</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
  });
});
