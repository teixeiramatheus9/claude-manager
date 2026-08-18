#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'];

export function addHooks(settings, command) {
  const next = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const eventName of HOOK_EVENTS) {
    const groups = [...(next.hooks[eventName] ?? [])];
    const alreadyInstalled = groups.some((group) =>
      (group.hooks ?? []).some((hook) => hook.command === command),
    );
    if (!alreadyInstalled) groups.push({ hooks: [{ type: 'command', command }] });
    next.hooks[eventName] = groups;
  }
  return next;
}

export function removeHooks(settings, command) {
  const next = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const eventName of HOOK_EVENTS) {
    const groups = (next.hooks[eventName] ?? [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) => hook.command !== command),
      }))
      .filter((group) => group.hooks.length > 0);
    if (groups.length > 0) next.hooks[eventName] = groups;
    else delete next.hooks[eventName];
  }
  return next;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const hookScript = path.resolve(scriptDir, '..', 'src', 'hook', 'hook-emit.js');
  const command = `node "${hookScript}"`;
  const settingsPath =
    process.env.CLAUDE_SETTINGS ?? path.join(os.homedir(), '.claude', 'settings.json');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const backupPath = `${settingsPath}.claude-manager-${Date.now()}.bak`;
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`Backup: ${backupPath}`);
  } else {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  }

  const remove = process.argv.includes('--remove');
  const next = remove ? removeHooks(settings, command) : addHooks(settings, command);
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${remove ? 'Removed' : 'Installed'} Claude Manager hooks in ${settingsPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
