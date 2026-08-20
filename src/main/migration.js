// One-time rebrand migration: the app used to live as "claude-manager". The
// old config dir carries everything a user cares about — bubble position,
// sessions, settings and hundreds of MB of downloaded voices — so the first
// Vizor boot adopts it instead of starting from zero. Kept free of electron
// imports on purpose: decisions are testable here, index.js wires the paths.
// (The Claude Code hooks need no migration: they are matched by the
// 'hook-emit' marker, which survived the rename, so the boot reinstall
// replaces the old entries by itself.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function legacyConfigDir(home = os.homedir()) {
  return path.join(home, '.config', 'claude-manager');
}

export function legacyAutostartFile(home = os.homedir()) {
  return path.join(home, '.config', 'autostart', 'claude-manager.desktop');
}

// Runs before anything reads the config. Never throws: a failed migration
// must not stop the app from booting fresh.
export function migrateLegacyInstall({
  legacyDir,
  targetDir,
  legacyAutostart,
  fsApi = fs,
  enableAutostart,
  log,
}) {
  const result = { migratedConfig: false, migratedAutostart: false };
  try {
    if (fsApi.existsSync(legacyDir) && !fsApi.existsSync(targetDir)) {
      fsApi.mkdirSync(path.dirname(targetDir), { recursive: true });
      fsApi.renameSync(legacyDir, targetDir);
      result.migratedConfig = true;
      log?.(`migration: adopted ${legacyDir} as ${targetDir}`);
    }
  } catch (error) {
    log?.(`migration: config move failed, starting fresh: ${error}`);
  }
  try {
    if (fsApi.existsSync(legacyAutostart)) {
      enableAutostart?.();
      fsApi.rmSync(legacyAutostart, { force: true });
      result.migratedAutostart = true;
      log?.('migration: autostart entry renewed under the new name');
    }
  } catch (error) {
    log?.(`migration: autostart renewal failed: ${error}`);
  }
  return result;
}
