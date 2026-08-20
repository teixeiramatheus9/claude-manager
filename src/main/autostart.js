// Kept free of electron imports on purpose: the decisions are testable here
// and index.js does the app/loginItem wiring. Linux only — macOS and Windows
// go through app.setLoginItemSettings, which the OS manages natively.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function autostartFilePath(home = os.homedir()) {
  return path.join(home, '.config', 'autostart', 'claude-manager.desktop');
}

// Which command line boots this install at login. AppImages must relaunch the
// .AppImage file — execPath points inside the mounted squashfs, which is gone
// after quit. Packaged deb/rpm relaunch their own binary; a dev run needs the
// electron binary plus the app dir.
export function execLine({ isPackaged, execPath, appImage, appDir }) {
  if (appImage) return `"${appImage}" --no-sandbox`;
  if (isPackaged) return `"${execPath}" --no-sandbox`;
  return `"${execPath}" "${appDir}" --no-sandbox`;
}

export function desktopEntry({ execLine: exec, iconPath }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Claude Manager',
    'Comment=Gerente flutuante das sessões do Claude Code',
    `Exec=${exec}`,
    ...(iconPath ? [`Icon=${iconPath}`] : []),
    // Lets the desktop match the running window to this entry.
    'StartupWMClass=claude-manager',
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=false',
    'Terminal=false',
    '',
  ].join('\n');
}

export function applyLinuxAutostart(enabled, { entry, file = autostartFilePath(), fsApi = fs }) {
  if (!enabled) {
    fsApi.rmSync(file, { force: true });
    return;
  }
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  fsApi.writeFileSync(file, entry);
}
