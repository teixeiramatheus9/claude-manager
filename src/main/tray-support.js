import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// GNOME ships no tray. The bubble can park itself in one only when something
// implements the StatusNotifierItem host, which on GNOME means this extension —
// so the app installs it instead of leaving the feature dead on arrival.
// Ubuntu and Fedora take the exact same user-level route (no root, no dnf/apt);
// KDE already has a host, and macOS/Windows never get here.
export const APPINDICATOR_UUID = 'appindicatorsupport@rgcjonas.gmail.com';
const EXTENSIONS_DIR = path.join(
  os.homedir(),
  '.local',
  'share',
  'gnome-shell',
  'extensions',
);

export function shouldInstallTraySupport({ platform, desktop, hasTrayHost }) {
  if (platform !== 'linux' || hasTrayHost) return false;
  return /gnome/i.test(String(desktop ?? ''));
}

export function shellMajorVersion(versionBanner) {
  return String(versionBanner ?? '').match(/(\d+)/)?.[1] ?? null;
}

export function extensionZipUrl(versionBanner) {
  const major = shellMajorVersion(versionBanner);
  if (!major) return null;
  return `https://extensions.gnome.org/download-extension/${APPINDICATOR_UUID}.shell-extension.zip?shell_version=${major}`;
}

// gsettings prints an empty list as either "@as []" or "[]".
export function enabledExtensionsValue(current, uuid) {
  const items = String(current ?? '')
    .match(/'([^']+)'/g)
    ?.map((quoted) => quoted.slice(1, -1)) ?? [];
  if (items.includes(uuid)) return null;
  return `[${[...items, uuid].map((item) => `'${item}'`).join(', ')}]`;
}

export function isExtensionInstalled(uuid = APPINDICATOR_UUID) {
  return fs.existsSync(path.join(EXTENSIONS_DIR, uuid));
}

// Returns 'installed' (the tray starts working on the next login), 'present'
// or null. The shell only loads a new extension at startup, so nothing here
// can make the icon appear in the running session.
export async function installTraySupport({ execFn, fetchFn = fetch, log }) {
  if (isExtensionInstalled()) return 'present';
  const { stdout: banner } = await execFn('gnome-shell', ['--version']);
  const url = extensionZipUrl(banner);
  if (!url) return null;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`extensions.gnome.org -> ${response.status}`);
  const zipFile = path.join(os.tmpdir(), `${APPINDICATOR_UUID}.zip`);
  fs.writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
  await execFn('gnome-extensions', ['install', '--force', zipFile]);
  const { stdout: enabled } = await execFn('gsettings', [
    'get',
    'org.gnome.shell',
    'enabled-extensions',
  ]);
  const next = enabledExtensionsValue(enabled, APPINDICATOR_UUID);
  if (next) {
    await execFn('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', next]);
  }
  log?.('tray: appindicator extension installed — it loads on the next login');
  return 'installed';
}
