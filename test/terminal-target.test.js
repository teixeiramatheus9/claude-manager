import { describe, expect, it } from 'vitest';
import {
  selectExactTab,
  waveTabIndex,
  waveDbPath,
  readWaveTabIndex,
} from '../src/main/terminal-target.js';

function recorder(failOn = () => false) {
  const calls = [];
  const execFn = async (command, args, opts) => {
    calls.push({ command, args, opts });
    if (failOn(command, args)) throw new Error('exec failed');
    return { stdout: '' };
  };
  return { calls, execFn };
}

describe('selectExactTab', () => {
  it('does nothing without a capture', async () => {
    const { calls, execFn } = recorder();
    expect(await selectExactTab(null, { execFn })).toEqual({ selected: false, via: null });
    expect(await selectExactTab({}, { execFn })).toEqual({ selected: false, via: null });
    expect(calls).toHaveLength(0);
  });

  it('focuses the kitty window through its remote control socket', async () => {
    const { calls, execFn } = recorder();
    const result = await selectExactTab(
      { KITTY_WINDOW_ID: '3', KITTY_LISTEN_ON: 'unix:/tmp/kitty-sock' },
      { execFn },
    );
    expect(result).toEqual({ selected: true, via: 'kitty' });
    expect(calls[0].command).toBe('kitty');
    expect(calls[0].args).toEqual([
      '@',
      '--to',
      'unix:/tmp/kitty-sock',
      'focus-window',
      '--match',
      'id:3',
    ]);
  });

  it('skips kitty when remote control is not listening', async () => {
    const { calls, execFn } = recorder();
    const result = await selectExactTab({ KITTY_WINDOW_ID: '3' }, { execFn });
    expect(result).toEqual({ selected: false, via: null });
    expect(calls).toHaveLength(0);
  });

  it('activates the wezterm pane, pinning the mux socket when captured', async () => {
    const { calls, execFn } = recorder();
    const result = await selectExactTab(
      { WEZTERM_PANE: '7', WEZTERM_UNIX_SOCKET: '/tmp/wez.sock' },
      { execFn },
    );
    expect(result).toEqual({ selected: true, via: 'wezterm' });
    expect(calls[0].command).toBe('wezterm');
    expect(calls[0].args).toEqual(['cli', 'activate-pane', '--pane-id', '7']);
    expect(calls[0].opts.env.WEZTERM_UNIX_SOCKET).toBe('/tmp/wez.sock');
  });

  it('selects the tmux window and pane on the captured server socket', async () => {
    const { calls, execFn } = recorder();
    const result = await selectExactTab(
      { TMUX: '/tmp/tmux-1000/default,1234,0', TMUX_PANE: '%5' },
      { execFn },
    );
    expect(result).toEqual({ selected: true, via: 'tmux' });
    expect(calls.map((call) => call.args)).toEqual([
      ['-S', '/tmp/tmux-1000/default', 'select-window', '-t', '%5'],
      ['-S', '/tmp/tmux-1000/default', 'select-pane', '-t', '%5'],
      ['-S', '/tmp/tmux-1000/default', 'switch-client', '-t', '%5'],
    ]);
  });

  it('still selects on tmux when switch-client has no client to move', async () => {
    const { execFn } = recorder((_, args) => args.includes('switch-client'));
    const result = await selectExactTab(
      { TMUX: '/tmp/tmux-1000/default,1234,0', TMUX_PANE: '%5' },
      { execFn },
    );
    expect(result).toEqual({ selected: true, via: 'tmux' });
  });

  it('falls through the chain when a CLI is unavailable', async () => {
    const { calls, execFn } = recorder((command) => command === 'kitty');
    const result = await selectExactTab(
      {
        KITTY_WINDOW_ID: '3',
        KITTY_LISTEN_ON: 'unix:/tmp/kitty-sock',
        WEZTERM_PANE: '7',
      },
      { execFn },
    );
    expect(result).toEqual({ selected: true, via: 'wezterm' });
    expect(calls).toHaveLength(2);
  });

  it('reports nothing selected when every CLI fails', async () => {
    const { execFn } = recorder(() => true);
    const result = await selectExactTab(
      { WEZTERM_PANE: '7', TMUX: '/tmp/sock,1,0', TMUX_PANE: '%1' },
      { execFn },
    );
    expect(result).toEqual({ selected: false, via: null });
  });
});

describe('waveTabIndex', () => {
  const row = (workspace) => JSON.stringify(workspace);

  it('finds the visible index and whether the tab is active', () => {
    const rows = row({ tabids: ['a', 'b', 'c'], pinnedtabids: [], activetabid: 'a' });
    expect(waveTabIndex(rows, 'c')).toEqual({ index: 2, active: false });
    expect(waveTabIndex(rows, 'a')).toEqual({ index: 0, active: true });
  });

  it('counts pinned tabs first, the way the tab bar shows them', () => {
    const rows = row({ tabids: ['a', 'b', 'c'], pinnedtabids: ['c'], activetabid: 'a' });
    expect(waveTabIndex(rows, 'c')).toEqual({ index: 0, active: false });
    expect(waveTabIndex(rows, 'a')).toEqual({ index: 1, active: true });
  });

  it('searches across workspaces and survives garbage lines', () => {
    const rows = [
      'not json',
      row({ tabids: ['x'], pinnedtabids: [], activetabid: 'x' }),
      row({ tabids: ['a', 'b'], pinnedtabids: [], activetabid: 'b' }),
    ].join('\n');
    expect(waveTabIndex(rows, 'b')).toEqual({ index: 1, active: true });
    expect(waveTabIndex(rows, 'nope')).toBeNull();
    expect(waveTabIndex('', 'a')).toBeNull();
  });
});

describe('waveDbPath', () => {
  it('resolves the per-platform data dir', () => {
    expect(waveDbPath({ platform: 'darwin', home: '/Users/u', env: {} })).toBe(
      '/Users/u/Library/Application Support/waveterm/db/waveterm.db',
    );
    expect(
      waveDbPath({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } }),
    ).toContain('waveterm');
    expect(waveDbPath({ platform: 'linux', home: '/home/u', env: {} })).toBe(
      '/home/u/.local/share/waveterm/db/waveterm.db',
    );
    expect(waveDbPath({ platform: 'linux', home: '/home/u', env: { XDG_DATA_HOME: '/xdg' } })).toBe(
      '/xdg/waveterm/db/waveterm.db',
    );
    expect(waveDbPath({ platform: 'win32', env: {} })).toBeNull();
  });
});

describe('readWaveTabIndex', () => {
  it('reads the rows through the sqlite3 CLI', async () => {
    const rows = JSON.stringify({ tabids: ['t1', 't2'], pinnedtabids: [], activetabid: 't1' });
    const calls = [];
    const execFn = async (command, args) => {
      calls.push({ command, args });
      return { stdout: `${rows}\n` };
    };
    const result = await readWaveTabIndex('t2', { execFn, platform: 'darwin', home: '/u', env: {} });
    expect(result).toEqual({ index: 1, active: false });
    expect(calls[0].command).toBe('sqlite3');
    expect(calls[0].args[0]).toContain('mode=ro');
  });

  it('returns null without a tab id or a resolvable db path', async () => {
    const execFn = async () => ({ stdout: '' });
    expect(await readWaveTabIndex(null, { execFn })).toBeNull();
    expect(
      await readWaveTabIndex('t1', { execFn, platform: 'win32', env: {} }),
    ).toBeNull();
  });
});
