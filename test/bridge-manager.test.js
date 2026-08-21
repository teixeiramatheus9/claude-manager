import { describe, it, expect, vi } from 'vitest';
import {
  installBridge,
  uninstallBridge,
  bridgeStatus,
  autoSetupBridge,
  BRIDGE_UUID,
} from '../src/main/bridge-manager.js';

const fakeFs = (existing = []) => ({
  existsSync: (path) => existing.some((known) => path.includes(known)),
  cpSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
});

const execOk = async (command, args) => {
  if (command === 'gnome-extensions' && args[0] === 'info') return { stdout: '  Estado: ENABLED\n' };
  if (command === 'gdbus') return { stdout: "('1',)" };
  return { stdout: '' };
};

describe('installBridge', () => {
  it('copies the extension and enables it', async () => {
    const fsImpl = fakeFs();
    const result = await installBridge({ execFn: execOk, fsImpl, home: '/h', sourceDir: '/src/ext' });
    expect(fsImpl.cpSync).toHaveBeenCalledWith(
      '/src/ext',
      `/h/.local/share/gnome-shell/extensions/${BRIDGE_UUID}`,
      { recursive: true },
    );
    expect(result).toEqual({ installed: true, active: true });
  });

  it('reports active:false when the shell needs a relogin to load it', async () => {
    const execFn = async (command) => {
      if (command === 'gdbus') throw new Error('no bridge object');
      return { stdout: '' };
    };
    const result = await installBridge({
      execFn,
      fsImpl: fakeFs(),
      home: '/h',
      sourceDir: '/s',
      probeAttempts: 1,
      probeDelayMs: 0,
    });
    expect(result).toEqual({ installed: true, active: false });
  });
});

describe('bridgeStatus', () => {
  it('combines dir presence, enablement and the live probe', async () => {
    const status = await bridgeStatus({ execFn: execOk, fsImpl: fakeFs([BRIDGE_UUID]), home: '/h' });
    expect(status).toEqual({ installed: true, enabled: true, responding: true });
  });

  it('is all-false when nothing is installed', async () => {
    const status = await bridgeStatus({ execFn: execOk, fsImpl: fakeFs(), home: '/h' });
    expect(status).toEqual({ installed: false, enabled: false, responding: false });
  });
});

describe('uninstallBridge', () => {
  it('disables and removes the extension dir', async () => {
    const fsImpl = fakeFs([BRIDGE_UUID]);
    const calls = [];
    await uninstallBridge({
      execFn: async (command, args) => (calls.push([command, ...args]), { stdout: '' }),
      fsImpl,
      home: '/h',
    });
    expect(calls).toContainEqual(['gnome-extensions', 'disable', BRIDGE_UUID]);
    expect(fsImpl.rmSync).toHaveBeenCalled();
  });
});


describe('autoSetupBridge', () => {
  const base = { home: '/h', sourceDir: '/s', probeAttempts: 1, probeDelayMs: 0 };

  it('installs and enables on the first wayland boot and marks it done', async () => {
    const fsImpl = fakeFs();
    let marked = false;
    const result = await autoSetupBridge({
      ...base,
      execFn: execOk,
      fsImpl,
      done: false,
      markDone: () => {
        marked = true;
      },
    });
    expect(result).toEqual({ ran: true, active: true });
    expect(fsImpl.cpSync).toHaveBeenCalled();
    expect(marked).toBe(true);
  });

  it('never reinstalls after done — an uninstall is an opt-out', async () => {
    const fsImpl = fakeFs(); // bridge dir absent: the user removed it
    const result = await autoSetupBridge({
      ...base,
      execFn: execOk,
      fsImpl,
      done: true,
      markDone: () => {
        throw new Error('must not re-mark');
      },
    });
    expect(result).toEqual({ ran: false, active: false });
    expect(fsImpl.cpSync).not.toHaveBeenCalled();
  });

  it('keeps the files in sync with the bundled copy when already installed', async () => {
    const fsImpl = fakeFs([BRIDGE_UUID]);
    const result = await autoSetupBridge({
      ...base,
      execFn: execOk,
      fsImpl,
      done: true,
      markDone: () => {},
    });
    expect(result).toEqual({ ran: false, active: true });
    expect(fsImpl.cpSync).toHaveBeenCalled(); // refresh on app updates
  });
});
