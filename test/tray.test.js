import { describe, expect, it } from 'vitest';
import { hasTrayHostIn, trayMenuTemplate } from '../src/main/tray.js';

describe('trayMenuTemplate', () => {
  it('offers to hide the bubble while it is on screen', () => {
    const [toggle] = trayMenuTemplate({ bubbleVisible: true });
    expect(toggle).toMatchObject({ id: 'toggle', label: 'Esconder a bolha' });
  });

  it('offers to bring the bubble back once it is hidden', () => {
    const [toggle] = trayMenuTemplate({ bubbleVisible: false });
    expect(toggle).toMatchObject({ id: 'toggle', label: 'Mostrar a bolha' });
  });

  it('always keeps a real way out', () => {
    const quit = trayMenuTemplate({ bubbleVisible: true }).find((item) => item.id === 'quit');
    expect(quit.label).toBe('Encerrar');
  });
});

describe('hasTrayHostIn', () => {
  it('sees the tray host GNOME only has with the appindicator extension', () => {
    expect(hasTrayHostIn("('org.freedesktop.DBus', 'org.kde.StatusNotifierWatcher', ':1.42')")).toBe(
      true,
    );
  });

  it('reports no host on a bare GNOME session', () => {
    expect(hasTrayHostIn("('org.freedesktop.DBus', 'org.gnome.Shell', ':1.7')")).toBe(false);
  });

  it('treats a failed or empty probe as no host', () => {
    expect(hasTrayHostIn('')).toBe(false);
    expect(hasTrayHostIn(null)).toBe(false);
  });
});
