import { describe, it, expect } from 'vitest';
import {
  xdotoolDriver,
  bridgeDriver,
  resolveWindowDriver,
  bridgeResponding,
} from '../src/main/window-driver.js';

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

function fakeBridgeExec({ windows = [], version = '1', fail = false } = {}) {
  const calls = [];
  const execFn = async (command, args) => {
    calls.push({ command, args });
    if (fail) throw new Error('bridge not there');
    const method = args.find((arg) => String(arg).startsWith('app.vizor.Bridge.'));
    if (method?.endsWith('ListWindows')) return { stdout: `('${b64(JSON.stringify(windows))}',)` };
    if (method?.endsWith('GetTitle')) {
      const target = windows.find((window) => window.id === args[args.length - 1]);
      return { stdout: `('${b64(target?.title ?? '')}',)` };
    }
    if (method?.endsWith('Version')) return { stdout: `('${version}',)` };
    return { stdout: '()' };
  };
  return { execFn, calls };
}

describe('bridgeDriver', () => {
  it('lists windows decoding the base64 JSON payload', async () => {
    const { execFn } = fakeBridgeExec({
      windows: [
        { id: '7', wmClass: 'gnome-terminal-server', appId: '', title: 'PROJETO-ALFA', focused: false },
      ],
    });
    expect(await bridgeDriver({ execFn }).listWindows()).toEqual([
      { id: '7', wmClass: 'gnome-terminal-server', title: 'PROJETO-ALFA' },
    ]);
  });

  it('folds the wayland appId into wmClass so class hints keep matching', async () => {
    const { execFn } = fakeBridgeExec({
      windows: [{ id: '9', wmClass: '', appId: 'org.gnome.Ptyxis', title: 't', focused: true }],
    });
    expect((await bridgeDriver({ execFn }).listWindows())[0].wmClass).toBe('org.gnome.Ptyxis');
  });

  it('base64-encodes the text it types', async () => {
    const { execFn, calls } = fakeBridgeExec();
    await bridgeDriver({ execFn }).typeText('olá chefe');
    const typeCall = calls.find((call) => call.args.some((arg) => String(arg).endsWith('TypeText')));
    expect(typeCall.args[typeCall.args.length - 1]).toBe(b64('olá chefe'));
  });
});

describe('xdotoolDriver', () => {
  it('presses keys through xdotool with cleared modifiers', async () => {
    const calls = [];
    const execFn = async (command, args) => (calls.push({ command, args }), { stdout: '' });
    await xdotoolDriver({ execFn }).pressKey('ctrl+Next');
    expect(calls).toContainEqual({
      command: 'xdotool',
      args: ['key', '--clearmodifiers', 'ctrl+Next'],
    });
  });
});

describe('bridgeResponding', () => {
  it('is true when Version answers and false when the call fails', async () => {
    expect(await bridgeResponding({ execFn: fakeBridgeExec().execFn })).toBe(true);
    expect(await bridgeResponding({ execFn: fakeBridgeExec({ fail: true }).execFn })).toBe(false);
  });
});

describe('resolveWindowDriver', () => {
  it('keeps xdotool whenever input injection is allowed (X11)', async () => {
    const { driver, kind } = await resolveWindowDriver({
      canInjectInput: true,
      execFn: async () => ({ stdout: '' }),
    });
    expect(kind).toBe('xdotool');
    expect(typeof driver.pressKey).toBe('function');
  });

  it('upgrades to the bridge on wayland when it responds', async () => {
    const { kind } = await resolveWindowDriver({
      canInjectInput: false,
      execFn: fakeBridgeExec().execFn,
    });
    expect(kind).toBe('bridge');
  });

  it('falls back to xdotool on wayland when the bridge is silent', async () => {
    const { kind } = await resolveWindowDriver({
      canInjectInput: false,
      execFn: fakeBridgeExec({ fail: true }).execFn,
    });
    expect(kind).toBe('xdotool');
  });
});
