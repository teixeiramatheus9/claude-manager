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

export function trayMenuTemplate({ bubbleVisible }) {
  return [
    { id: 'toggle', label: bubbleVisible ? 'Esconder a bolha' : 'Mostrar a bolha' },
    { type: 'separator' },
    { id: 'quit', label: 'Encerrar' },
  ];
}

// macOS and Windows always have a tray; Linux has to be asked.
export async function detectTrayHost({ platform, execFn }) {
  if (platform !== 'linux') return true;
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
