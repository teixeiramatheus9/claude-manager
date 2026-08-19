import { describe, expect, it } from 'vitest';
import {
  APPINDICATOR_UUID,
  enabledExtensionsValue,
  extensionZipUrl,
  shellMajorVersion,
  shouldInstallTraySupport,
} from '../src/main/tray-support.js';

describe('shouldInstallTraySupport', () => {
  const gnomeWithoutTray = { platform: 'linux', desktop: 'GNOME', hasTrayHost: false };

  it('installs on a GNOME session that has no tray host', () => {
    expect(shouldInstallTraySupport(gnomeWithoutTray)).toBe(true);
    expect(shouldInstallTraySupport({ ...gnomeWithoutTray, desktop: 'ubuntu:GNOME' })).toBe(true);
  });

  it('leaves a session that already has a tray host alone', () => {
    expect(shouldInstallTraySupport({ ...gnomeWithoutTray, hasTrayHost: true })).toBe(false);
  });

  it('never touches KDE, macOS or Windows', () => {
    expect(shouldInstallTraySupport({ ...gnomeWithoutTray, desktop: 'KDE' })).toBe(false);
    expect(shouldInstallTraySupport({ ...gnomeWithoutTray, platform: 'darwin' })).toBe(false);
    expect(shouldInstallTraySupport({ ...gnomeWithoutTray, platform: 'win32' })).toBe(false);
  });
});

describe('extensionZipUrl', () => {
  it('asks for the build matching the running shell', () => {
    expect(extensionZipUrl('GNOME Shell 49.7')).toBe(
      `https://extensions.gnome.org/download-extension/${APPINDICATOR_UUID}.shell-extension.zip?shell_version=49`,
    );
  });

  it('gives up when the shell version is unreadable', () => {
    expect(extensionZipUrl('')).toBe(null);
    expect(extensionZipUrl(null)).toBe(null);
  });
});

describe('shellMajorVersion', () => {
  it('reads the major out of the version banner', () => {
    expect(shellMajorVersion('GNOME Shell 49.7')).toBe('49');
    expect(shellMajorVersion('GNOME Shell 3.38.4')).toBe('3');
  });
});

describe('enabledExtensionsValue', () => {
  it('appends to what gsettings already lists', () => {
    expect(enabledExtensionsValue("['background-logo@fedorahosted.org']", 'x@y')).toBe(
      "['background-logo@fedorahosted.org', 'x@y']",
    );
  });

  it('handles the empty-list forms gsettings prints', () => {
    expect(enabledExtensionsValue('@as []', 'x@y')).toBe("['x@y']");
    expect(enabledExtensionsValue('[]', 'x@y')).toBe("['x@y']");
  });

  it('has nothing to write when it is already enabled', () => {
    expect(enabledExtensionsValue("['x@y']", 'x@y')).toBe(null);
  });
});
