import { app, shell } from 'electron';
import electronUpdaterPackage from 'electron-updater';
import { isNewerVersion } from './version-utils.js';

const RELEASES_LATEST_API =
  'https://api.github.com/repos/teixeiramatheus9/claude-manager/releases/latest';
export const RELEASES_PAGE = 'https://github.com/teixeiramatheus9/claude-manager/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Hybrid updates:
// - AppImage: true auto-update via electron-updater (downloads in the
//   background, swap-on-restart).
// - deb/rpm/dmg (package-manager owned / unsigned): notify-only — check the
//   latest GitHub release and point the user at it.
// - dev (not packaged): disabled.
export function setupUpdater({ onStatus, log, fetchFn = fetch }) {
  const status = { mode: 'off', available: null, ready: null };
  const notify = () => onStatus({ ...status });

  if (!app.isPackaged) {
    return { status: () => ({ ...status }), apply: () => {} };
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
    const check = () => autoUpdater.checkForUpdates().catch((error) => log(`updater check: ${error}`));
    check();
    setInterval(check, CHECK_INTERVAL_MS);
    return {
      status: () => ({ ...status }),
      apply: () => {
        if (status.ready) autoUpdater.quitAndInstall();
      },
    };
  }

  status.mode = 'notify';
  const check = async () => {
    try {
      const response = await fetchFn(RELEASES_LATEST_API, {
        headers: { accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return;
      const release = await response.json();
      const latest = String(release.tag_name ?? '').replace(/^v/, '');
      if (latest && isNewerVersion(latest, app.getVersion())) {
        status.available = latest;
        notify();
      }
    } catch (error) {
      log(`update check failed: ${error}`);
    }
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
  return {
    status: () => ({ ...status }),
    apply: () => shell.openExternal(RELEASES_PAGE),
  };
}
