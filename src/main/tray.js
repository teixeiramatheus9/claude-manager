// Kept free of electron imports on purpose: the decisions are testable here and
// index.js does the Tray/Menu wiring.

// GNOME dropped the legacy systray, so an icon only shows up when something
// implements the StatusNotifierItem host — on GNOME that means the appindicator
// extension. Without a host the icon silently goes nowhere, which would make
// "hide to tray" a trap: no bubble, no menu, no way back.
const TRAY_HOST_NAME = 'org.kde.StatusNotifierWatcher';

export function hasTrayHostIn(dbusNames) {
  return String(dbusNames ?? '').includes(TRAY_HOST_NAME);
}

// The tray is the only handle left when the bubble is parked, so it opens the
// app and its settings directly — a menu that could only toggle the bubble
// still made you click the bubble to get anywhere.
export function trayMenuTemplate({ bubbleVisible }) {
  return [
    { id: 'panel', label: 'Abrir o painel' },
    { id: 'settings', label: 'Configurações' },
    { type: 'separator' },
    { id: 'toggle', label: bubbleVisible ? 'Esconder a bolha' : 'Mostrar a bolha' },
    { type: 'separator' },
    { id: 'quit', label: 'Encerrar' },
  ];
}

// Electron names its StatusNotifierItem after the process: pid plus a counter
// that is 1 for the first (and here only) Tray of the process.
export function trayItemServiceName(pid) {
  return `org.freedesktop.StatusNotifierItem-${pid}-1`;
}

// Right after startup Electron's item answers property reads with errors, and
// GNOME's appindicator extension only retries for ~3s before dropping the icon
// for good — registered, alive, invisible. Re-registering makes the watcher
// reset the item and read the properties again, which succeeds once the app
// has settled; doing it twice covers a slow start. Idempotent: the watcher
// resets an item it already shows instead of duplicating it.
const REREGISTER_DELAYS_MS = [6000, 20000];

export async function nudgeTrayRegistration({
  pid,
  execFn,
  waitFn,
  delays = REREGISTER_DELAYS_MS,
  log,
}) {
  for (const delay of delays) {
    await waitFn(delay);
    try {
      await execFn('gdbus', [
        'call',
        '--session',
        '--dest',
        'org.kde.StatusNotifierWatcher',
        '--object-path',
        '/StatusNotifierWatcher',
        '--method',
        'org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem',
        trayItemServiceName(pid),
      ]);
    } catch (error) {
      log?.(`tray: re-register nudge failed: ${error}`);
    }
  }
}

// Linux only, on purpose. On macOS closing the app is meant to end it — and
// to take this app's Claude Code hooks with it — so there is nothing to park
// in the menu bar.
export async function detectTrayHost({ platform, execFn }) {
  if (platform !== 'linux') return false;
  try {
    const { stdout } = await execFn('gdbus', [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.ListNames',
    ]);
    return hasTrayHostIn(stdout);
  } catch {
    return false;
  }
}
