#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildDesktopEntry({ electronBinary, appDir, iconPath }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Claude Manager',
    'Comment=Gerente flutuante das sessões do Claude Code',
    // The raw electron binary needs no node/nvm on the login PATH.
    `Exec="${electronBinary}" "${appDir}" --no-sandbox`,
    ...(iconPath ? [`Icon=${iconPath}`] : []),
    // Lets GNOME match the running window to this entry (alt-tab/dock icon).
    'StartupWMClass=claude-manager',
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=false',
    'Terminal=false',
    '',
  ].join('\n');
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(scriptDir, '..');
  const electronBinary = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron');
  const iconPath = path.join(appDir, 'assets', 'icon.png');
  const autostartFile = path.join(os.homedir(), '.config', 'autostart', 'claude-manager.desktop');
  const applicationsFile = path.join(
    os.homedir(),
    '.local',
    'share',
    'applications',
    'claude-manager.desktop',
  );

  if (process.argv.includes('--remove')) {
    for (const file of [autostartFile, applicationsFile]) {
      fs.rmSync(file, { force: true });
      console.log(`Removed ${file}`);
    }
    return;
  }

  const entry = buildDesktopEntry({ electronBinary, appDir, iconPath });
  for (const file of [autostartFile, applicationsFile]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entry);
    console.log(`Installed ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
