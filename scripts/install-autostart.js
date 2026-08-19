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

export function buildLaunchAgentPlist({ electronBinary, appDir }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>io.github.teixeiramatheus9.claude-manager</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${electronBinary}</string>`,
    `    <string>${appDir}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function darwinMain() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(scriptDir, '..');
  const electronBinary = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron');
  const plistFile = path.join(
    os.homedir(),
    'Library',
    'LaunchAgents',
    'io.github.teixeiramatheus9.claude-manager.plist',
  );

  if (process.argv.includes('--remove')) {
    fs.rmSync(plistFile, { force: true });
    console.log(`Removed ${plistFile}`);
    return;
  }

  fs.mkdirSync(path.dirname(plistFile), { recursive: true });
  fs.writeFileSync(plistFile, buildLaunchAgentPlist({ electronBinary, appDir }));
  console.log(`Installed ${plistFile}`);
}

function main() {
  if (process.platform === 'darwin') {
    darwinMain();
    return;
  }
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
