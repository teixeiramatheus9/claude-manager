import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bridgeResponding } from './window-driver.js';

const execFileAsync = promisify(execFile);

export const BRIDGE_UUID = 'vizor-bridge@vizor.app';

const targetDir = (home) =>
  path.join(home, '.local', 'share', 'gnome-shell', 'extensions', BRIDGE_UUID);

// Where the extension ships inside the app. Dev runs from the repo tree;
// packaged builds carry it via electron-builder extraResources.
export function bundledExtensionDir() {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'gnome-extension', BRIDGE_UUID)
    : null;
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(import.meta.dirname, '..', '..', 'resources', 'gnome-extension', BRIDGE_UUID);
}

async function probe(execFn, { attempts = 3, delayMs = 700 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await bridgeResponding({ execFn })) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export async function installBridge({
  execFn = execFileAsync,
  fsImpl = fs,
  home = os.homedir(),
  sourceDir = bundledExtensionDir(),
  probeAttempts = 3,
  probeDelayMs = 700,
} = {}) {
  const target = targetDir(home);
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  fsImpl.cpSync(sourceDir, target, { recursive: true });
  try {
    await execFn('gnome-extensions', ['enable', BRIDGE_UUID]);
  } catch {
    // older gnome-extensions may not know the uuid until the shell rescans;
    // the probe below tells the caller whether a relogin is needed.
  }
  return { installed: true, active: await probe(execFn, { attempts: probeAttempts, delayMs: probeDelayMs }) };
}

export async function uninstallBridge({
  execFn = execFileAsync,
  fsImpl = fs,
  home = os.homedir(),
} = {}) {
  try {
    await execFn('gnome-extensions', ['disable', BRIDGE_UUID]);
  } catch {
    // not enabled — removal below is what matters
  }
  fsImpl.rmSync(targetDir(home), { recursive: true, force: true });
}

export async function bridgeStatus({
  execFn = execFileAsync,
  fsImpl = fs,
  home = os.homedir(),
} = {}) {
  const installed = fsImpl.existsSync(targetDir(home));
  let enabled = false;
  if (installed) {
    try {
      const { stdout } = await execFn('gnome-extensions', ['info', BRIDGE_UUID]);
      // 'State/Estado: ENABLED|ACTIVE' — locale-proof match on the value.
      enabled = /:\s*(ENABLED|ACTIVE)\b/i.test(String(stdout ?? ''));
    } catch {
      enabled = false;
    }
  }
  const responding = installed ? await bridgeResponding({ execFn }) : false;
  return { installed, enabled, responding };
}
