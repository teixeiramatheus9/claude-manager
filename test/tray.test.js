import { describe, expect, it } from 'vitest';
import {
  detectTrayHost,
  hasTrayHostIn,
  nudgeTrayRegistration,
  trayItemServiceName,
  trayMenuTemplate,
} from '../src/main/tray.js';

describe('trayMenuTemplate', () => {
  const ids = (options) => trayMenuTemplate(options).filter((item) => item.id).map((item) => item.id);

  it('opens the app and its settings straight from the tray', () => {
    // the tray is the only handle when the bubble is parked, so it has to do
    // more than toggle: reaching the panel or the settings took a bubble click
    expect(ids({ bubbleVisible: false })).toContain('panel');
    expect(ids({ bubbleVisible: false })).toContain('settings');
  });

  it('offers to hide the bubble while it is on screen', () => {
    const toggle = trayMenuTemplate({ bubbleVisible: true }).find((item) => item.id === 'toggle');
    expect(toggle.label).toBe('Esconder a bolha');
  });

  it('offers to bring the bubble back once it is hidden', () => {
    const toggle = trayMenuTemplate({ bubbleVisible: false }).find((item) => item.id === 'toggle');
    expect(toggle.label).toBe('Mostrar a bolha');
  });

  it('always keeps a real way out, and keeps it last', () => {
    const items = trayMenuTemplate({ bubbleVisible: true }).filter((item) => item.id);
    expect(items.at(-1)).toMatchObject({ id: 'quit', label: 'Encerrar' });
  });

  it('labels every item — an unlabelled entry renders blank in the menu', () => {
    for (const item of trayMenuTemplate({ bubbleVisible: true })) {
      if (item.id) expect(item.label).toBeTruthy();
    }
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

describe('detectTrayHost', () => {
  const shouldNotRun = () => {
    throw new Error('probed the bus off Linux');
  };

  it('gives macOS no tray: closing the app there ends it, hooks included', async () => {
    await expect(detectTrayHost({ platform: 'darwin', execFn: shouldNotRun })).resolves.toBe(false);
  });

  it('asks the session bus on Linux', async () => {
    const execFn = async () => ({ stdout: "('org.kde.StatusNotifierWatcher',)" });
    await expect(detectTrayHost({ platform: 'linux', execFn })).resolves.toBe(true);
  });

  it('treats a missing gdbus as no tray', async () => {
    const execFn = async () => {
      throw new Error('ENOENT');
    };
    await expect(detectTrayHost({ platform: 'linux', execFn })).resolves.toBe(false);
  });
});

describe('trayItemServiceName', () => {
  it("names the item the way Electron registers it on the bus", () => {
    expect(trayItemServiceName(300874)).toBe('org.freedesktop.StatusNotifierItem-300874-1');
  });
});

describe('nudgeTrayRegistration', () => {
  const collect = () => {
    const calls = [];
    return {
      calls,
      execFn: async (cmd, args) => calls.push({ kind: 'exec', cmd, args }),
      waitFn: async (ms) => calls.push({ kind: 'wait', ms }),
    };
  };

  it('asks the watcher to register the item again after each delay', async () => {
    const { calls, execFn, waitFn } = collect();
    await nudgeTrayRegistration({ pid: 4242, execFn, waitFn, delays: [5000, 15000] });

    expect(calls.map((c) => c.kind)).toEqual(['wait', 'exec', 'wait', 'exec']);
    expect(calls[0].ms).toBe(5000);
    expect(calls[2].ms).toBe(15000);
    for (const { cmd, args } of calls.filter((c) => c.kind === 'exec')) {
      expect(cmd).toBe('gdbus');
      expect(args).toContain('org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem');
      expect(args.at(-1)).toBe('org.freedesktop.StatusNotifierItem-4242-1');
    }
  });

  it('keeps nudging when one attempt fails, and never throws', async () => {
    const attempts = [];
    const execFn = async () => {
      attempts.push('exec');
      throw new Error('gdbus exploded');
    };
    await expect(
      nudgeTrayRegistration({ pid: 1, execFn, waitFn: async () => {}, delays: [1, 2] }),
    ).resolves.toBeUndefined();
    expect(attempts).toHaveLength(2);
  });

  it('waits out the extension retry window by default', async () => {
    const { calls, execFn, waitFn } = collect();
    await nudgeTrayRegistration({ pid: 1, execFn, waitFn });

    const waits = calls.filter((c) => c.kind === 'wait');
    expect(waits.length).toBeGreaterThanOrEqual(1);
    // the appindicator extension gives up ~3-4s in — nudging sooner re-fails
    expect(waits[0].ms).toBeGreaterThan(4000);
  });
});
