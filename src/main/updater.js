import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, shell } from 'electron';
import electronUpdaterPackage from 'electron-updater';
import { isNewerVersion } from './version-utils.js';
import { pickPackageAsset } from './update-assets.js';

const execFileAsync = promisify(execFile);

const RELEASES_LATEST_API =
  'https://api.github.com/repos/teixeiramatheus9/claude-manager/releases/latest';
export const RELEASES_PAGE = 'https://github.com/teixeiramatheus9/claude-manager/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

async function detectInstalledFormat() {
  try {
    await execFileAsync('dpkg', ['-s', 'claude-manager']);
    return 'deb';
  } catch {
    // not a deb install
  }
  try {
    await execFileAsync('rpm', ['-q', 'claude-manager']);
    return 'rpm';
  } catch {
    return null;
  }
}

// Hybrid updates:
// - AppImage: true auto-update via electron-updater (swap-on-restart).
// - deb/rpm: downloads the matching package and installs it via pkexec
//   (native auth prompt), then relaunches — no manual uninstall/reinstall.
// - dmg/unknown: opens the latest release page.
// - dev (not packaged): disabled.
export function setupUpdater({ onStatus, log, fetchFn = fetch }) {
  const status = { mode: 'off', available: null, ready: null, installing: false };
  const notify = () => onStatus({ ...status });

  if (!app.isPackaged) {
    return { status: () => ({ ...status }), apply: () => {}, check: async () => ({ ...status }) };
  }

  if (process.env.APPIMAGE) {
    status.mode = 'auto';
    const { autoUpdater } = electronUpdaterPackage;
    autoUpdater.autoDownload = true;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (info) => {
      status.available = info.version;
      notify();
    });
    autoUpdater.on('update-downloaded', (info) => {
      status.ready = info.version;
      notify();
    });
    autoUpdater.on('error', (error) => log(`updater: ${error}`));
    const check = async () => {
      await autoUpdater.checkForUpdates().catch((error) => log(`updater check: ${error}`));
      return { ...status };
    };
    check();
    setInterval(check, CHECK_INTERVAL_MS);
    return {
      status: () => ({ ...status }),
      check,
      apply: () => {
        if (status.ready) autoUpdater.quitAndInstall();
      },
    };
  }

  status.mode = 'notify';

  const fetchLatestRelease = async () => {
    const response = await fetchFn(RELEASES_LATEST_API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`releases/latest -> ${response.status}`);
    return response.json();
  };

  const check = async () => {
    try {
      const release = await fetchLatestRelease();
      const latest = String(release.tag_name ?? '').replace(/^v/, '');
      if (latest && isNewerVersion(latest, app.getVersion())) {
        status.available = latest;
        notify();
      }
    } catch (error) {
      log(`update check failed: ${error}`);
    }
    return { ...status };
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);

  const installPackage = async () => {
    const format = await detectInstalledFormat();
    if (!format) {
      shell.openExternal(RELEASES_PAGE);
      return;
    }
    const release = await fetchLatestRelease();
    const asset = pickPackageAsset(release.assets, format, process.arch);
    if (!asset?.browser_download_url) {
      shell.openExternal(RELEASES_PAGE);
      return;
    }
    log(`updater: downloading ${asset.name}…`);
    const response = await fetchFn(asset.browser_download_url);
    if (!response.ok) throw new Error(`asset download -> ${response.status}`);
    const packageFile = path.join(os.tmpdir(), asset.name);
    fs.writeFileSync(packageFile, Buffer.from(await response.arrayBuffer()));
    const installArgs =
      format === 'deb'
        ? ['apt-get', 'install', '-y', packageFile]
        : fs.existsSync('/usr/bin/dnf')
          ? ['dnf', 'install', '-y', packageFile]
          : ['rpm', '-U', packageFile];
    log(`updater: installing via pkexec ${installArgs[0]}…`);
    await execFileAsync('pkexec', installArgs, { timeout: INSTALL_TIMEOUT_MS });
    log('updater: installed, relaunching');
    app.relaunch();
    app.exit(0);
  };

  return {
    status: () => ({ ...status }),
    check,
    apply: async () => {
      if (!status.available || status.installing) return;
      status.installing = true;
      notify();
      try {
        await installPackage();
      } catch (error) {
        // user cancelled the auth prompt or something broke — hand over the page
        log(`self-install failed: ${error}`);
        shell.openExternal(RELEASES_PAGE);
      } finally {
        status.installing = false;
        notify();
      }
    },
  };
}
