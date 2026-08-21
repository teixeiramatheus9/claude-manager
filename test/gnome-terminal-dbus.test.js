import { describe, it, expect } from 'vitest';
import { listTerminalWindows, selectTab } from '../src/main/gnome-terminal-dbus.js';

const introspection = 'node /org/gnome/Terminal/window {\n  node 1 {};\n  node 3 {};\n}';

describe('listTerminalWindows', () => {
  it('parses window object paths out of the introspection', async () => {
    const execFn = async () => ({ stdout: introspection });
    expect(await listTerminalWindows({ execFn })).toEqual([
      '/org/gnome/Terminal/window/1',
      '/org/gnome/Terminal/window/3',
    ]);
  });

  it('returns empty when gnome-terminal is not on the bus', async () => {
    const execFn = async () => {
      throw new Error('no such name');
    };
    expect(await listTerminalWindows({ execFn })).toEqual([]);
  });
});

describe('selectTab', () => {
  it('activates the index and confirms through the action state', async () => {
    const calls = [];
    const execFn = async (command, args) => {
      calls.push(args);
      if (args.includes('org.gtk.Actions.Describe'))
        return { stdout: "((true, signature 'i', [<2>]),)" };
      return { stdout: '()' };
    };
    expect(await selectTab({ execFn }, '/org/gnome/Terminal/window/1', 2)).toBe(true);
    const activate = calls.find((args) => args.includes('org.gtk.Actions.Activate'));
    expect(activate).toContain('[<2>]');
  });

  it('reports false when the window clamps the index (out of range)', async () => {
    const execFn = async (command, args) =>
      args.includes('org.gtk.Actions.Describe')
        ? { stdout: "((true, signature 'i', [<0>]),)" }
        : { stdout: '()' };
    expect(await selectTab({ execFn }, '/org/gnome/Terminal/window/1', 5)).toBe(false);
  });

  it('reports false when the call itself fails', async () => {
    const execFn = async () => {
      throw new Error('window gone');
    };
    expect(await selectTab({ execFn }, '/org/gnome/Terminal/window/1', 0)).toBe(false);
  });
});
