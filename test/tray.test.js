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

  it('proves the item answers reads before asking the watcher, then stops', async () => {
    // a re-register makes the extension reset the item and read it again — done
    // while reads still fail, that reset tears down an icon already on screen
    const { calls, execFn, waitFn } = collect();
    await nudgeTrayRegistration({ pid: 4242, execFn, waitFn, delays: [5000, 15000, 30000] });

    // wait, probe, register, then wait out the deaf spell and prove it stuck
    expect(calls.map((c) => c.kind)).toEqual(['wait', 'exec', 'exec', 'wait', 'exec']);
    const [probe, register, recheck] = calls.filter((c) => c.kind === 'exec');
    expect(probe.cmd).toBe('gdbus');
    expect(probe.args).toContain('org.freedesktop.StatusNotifierItem-4242-1');
    expect(probe.args).toContain('org.freedesktop.DBus.Properties.Get');
    expect(register.args).toContain('org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem');
    expect(register.args.at(-1)).toBe('org.freedesktop.StatusNotifierItem-4242-1');
    expect(recheck.args).toContain('org.freedesktop.DBus.Properties.Get');
  });

  it('registers again when the register itself lands in a deaf spell', async () => {
    // registering wakes the item's own re-export, so reads right after it can
    // fail — an extension read in that window leaves the icon up but unwired
    const calls = [];
    let probes = 0;
    const execFn = async (cmd, args) => {
      calls.push(args);
      if (args.includes('org.freedesktop.DBus.Properties.Get') && ++probes === 2)
        throw new Error('error occurred in Get');
    };
    await nudgeTrayRegistration({ pid: 7, execFn, waitFn: async () => {}, delays: [1, 2] });

    const registers = calls.filter((args) =>
      args.includes('org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem'),
    );
    // probe ok, register, recheck fails -> second round: probe, register, recheck ok
    expect(registers).toHaveLength(2);
    expect(probes).toBe(4);
  });

  it('holds the re-register while the probe still fails, and retries later', async () => {
    const calls = [];
    let failures = 1;
    const execFn = async (cmd, args) => {
      calls.push(args);
      if (args.includes('org.freedesktop.DBus.Properties.Get') && failures-- > 0)
        throw new Error('error occurred in Get');
    };
    await nudgeTrayRegistration({ pid: 7, execFn, waitFn: async () => {}, delays: [1, 2, 3] });

    const registers = calls.filter((args) =>
      args.includes('org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem'),
    );
    expect(registers).toHaveLength(1);
    expect(calls).toHaveLength(4); // failed probe, good probe, register, recheck
  });

  it('gives up quietly when the item never answers', async () => {
    const attempts = [];
    const execFn = async () => {
      attempts.push('exec');
      throw new Error('gdbus exploded');
    };
    await expect(
      nudgeTrayRegistration({ pid: 1, execFn, waitFn: async () => {}, delays: [1, 2] }),
    ).resolves.toBeUndefined();
    expect(attempts).toHaveLength(2); // one failed probe per delay, no registers
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
