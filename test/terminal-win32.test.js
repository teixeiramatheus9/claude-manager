import { describe, it, expect, vi } from 'vitest';
import {
  TERMINALS,
  focusChatTab,
  answerQuestionInWarp,
  sendReplyToWarp,
} from '../src/main/terminal-win32.js';

function fakeNative(windows, { titles = [] } = {}) {
  let titleCall = 0;
  return {
    listWindows: vi.fn().mockResolvedValue(windows),
    activateWindow: vi.fn().mockResolvedValue(undefined),
    getWindowTitle: vi.fn().mockImplementation(async () => titles[titleCall++] ?? ''),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TERMINALS (win32)', () => {
  it('offers the terminals that exist on Windows', () => {
    expect(Object.keys(TERMINALS)).toEqual([
      'auto',
      'windows-terminal',
      'warp',
      'waveterm',
      'alacritty',
      'wezterm',
    ]);
    expect(TERMINALS['windows-terminal'].exeHint).toBe('windowsterminal');
    expect(TERMINALS.alacritty.hasTabs).toBe(false);
  });
});

describe('exact focus via the captured terminal identity (win32)', () => {
  it('activates the wezterm pane through its CLI and raises the window', async () => {
    const native = fakeNative([
      { id: '1', class: 'windowsterminal', title: 'outra-coisa' },
      { id: '2', class: 'wezterm-gui', title: 'claude — wezterm' },
    ]);
    const calls = [];
    const execFn = async (command, args, opts) => {
      calls.push({ command, args, opts });
      return { stdout: '' };
    };
    const result = await focusChatTab(['chat-inexistente-xyz'], {
      native,
      execFn,
      delayMs: 0,
      term: { WEZTERM_PANE: '7' },
    });
    expect(calls[0]).toMatchObject({
      command: 'wezterm',
      args: ['cli', 'activate-pane', '--pane-id', '7'],
    });
    expect(native.activateWindow).toHaveBeenCalledWith('2', expect.anything());
    expect(result.tabFound).toBe(true);
    expect(native.sendKeys).not.toHaveBeenCalled();
  });

  it('falls back to the title hunt when the CLI is unavailable', async () => {
    const native = fakeNative([
      { id: '2', class: 'wezterm-gui', title: 'claude-manager — claude' },
    ]);
    const execFn = async () => {
      throw new Error('wezterm not on PATH');
    };
    const result = await focusChatTab(['claude-manager'], {
      native,
      execFn,
      delayMs: 0,
      term: { WEZTERM_PANE: '7' },
    });
    expect(result.tabFound).toBe(true);
    expect(result.matchedTitle).toBe('claude-manager — claude');
  });
});

describe('focusChatTab', () => {
  it('activates a window whose title already matches', async () => {
    const native = fakeNative([
      { id: '1', class: 'chrome', title: 'claude-manager — GitHub' },
      { id: '2', class: 'windowsterminal', title: 'claude-manager — claude' },
    ]);
    const result = await focusChatTab(['claude-manager'], { native });
    expect(native.activateWindow).toHaveBeenCalledWith('2', expect.anything());
    expect(result).toEqual({
      focused: true,
      tabFound: true,
      matchedTitle: 'claude-manager — claude',
      cause: null,
    });
  });

  it('never focuses a non-terminal window even when its title matches', async () => {
    const native = fakeNative([{ id: '1', class: 'chrome', title: 'claude-manager' }]);
    const result = await focusChatTab(['claude-manager'], { native });
    expect(native.activateWindow).not.toHaveBeenCalled();
    expect(result.cause).toBe('terminal-not-found');
  });

  it('cycles tabs with ctrl+tab until the title matches', async () => {
    const native = fakeNative(
      [{ id: '5', class: 'windowsterminal', title: 'other-project' }],
      { titles: ['other-project', 'still-nope', 'claude-manager — claude'] },
    );
    const result = await focusChatTab(['claude-manager'], { native, delayMs: 0 });
    expect(native.sendKeys.mock.calls.map(([keys]) => keys)).toEqual(['^{TAB}', '^{TAB}']);
    expect(result.tabFound).toBe(true);
    expect(result.matchedTitle).toBe('claude-manager — claude');
  });

  it('stops cycling when the title wraps around', async () => {
    const native = fakeNative(
      [{ id: '5', class: 'windowsterminal', title: 'tab-a' }],
      { titles: ['tab-a', 'tab-b', 'tab-a'] },
    );
    const result = await focusChatTab(['claude-manager'], { native, delayMs: 0 });
    expect(result).toMatchObject({ focused: true, tabFound: false });
  });

  it('skips key injection when allowInputInjection is false', async () => {
    const native = fakeNative([{ id: '5', class: 'windowsterminal', title: 'other' }]);
    await focusChatTab(['claude-manager'], { native, allowInputInjection: false });
    expect(native.sendKeys).not.toHaveBeenCalled();
  });

  it('reports no-windows when the listing is empty', async () => {
    const native = fakeNative([]);
    const result = await focusChatTab(['x'], { native });
    expect(result.cause).toBe('no-windows');
  });

  it('focuses the wave block via wsh when the hook captured wave credentials', async () => {
    const native = fakeNative([{ id: '9', class: 'wave', title: 'Wave' }]);
    const execFn = vi.fn().mockResolvedValue({ stdout: '' });
    const wave = { blockId: 'b1', tabId: 't1', jwt: 'j1' };
    const result = await focusChatTab(['proj'], { native, execFn, wave, terminal: 'waveterm' });
    expect(execFn).toHaveBeenCalledWith(
      expect.stringContaining('wsh'),
      ['focusblock', '-b', 'b1'],
      expect.objectContaining({ env: expect.objectContaining({ WAVETERM_JWT: 'j1' }) }),
    );
    expect(result.tabFound).toBe(true);
  });

  it('switches to the wave block tab with Ctrl+n before focusing the block', async () => {
    const native = fakeNative([{ id: '9', class: 'wave', title: 'Wave' }]);
    const workspaceRow = JSON.stringify({
      tabids: ['t0', 't1', 't2'],
      pinnedtabids: [],
      activetabid: 't0',
    });
    const execFn = vi.fn().mockImplementation(async (command) => ({
      stdout: command === 'sqlite3' ? `${workspaceRow}\n` : '',
    }));
    const wave = { blockId: 'b1', tabId: 't1', jwt: 'j1' };
    const result = await focusChatTab(['proj'], {
      native,
      execFn,
      wave,
      terminal: 'waveterm',
      delayMs: 0,
    });
    // t1 sits at visible index 1 → Ctrl+2, then focusblock inside the tab
    expect(native.sendKeys).toHaveBeenCalledWith('^2', expect.anything());
    expect(execFn).toHaveBeenCalledWith(
      expect.stringContaining('wsh'),
      ['focusblock', '-b', 'b1'],
      expect.anything(),
    );
    expect(result.tabFound).toBe(true);
  });
});

describe('answerQuestionInWarp', () => {
  it('presses Down x index then Enter once the tab is found', async () => {
    const native = fakeNative([{ id: '2', class: 'windowsterminal', title: 'claude-manager' }]);
    const result = await answerQuestionInWarp(['claude-manager'], 2, { native, delayMs: 0 });
    expect(native.sendKeys.mock.calls.map(([keys]) => keys)).toEqual([
      '{DOWN}',
      '{DOWN}',
      '{ENTER}',
    ]);
    expect(result).toBe('answered');
  });

  it('returns needs-terminal when input injection is off', async () => {
    const native = fakeNative([{ id: '2', class: 'windowsterminal', title: 'claude-manager' }]);
    const result = await answerQuestionInWarp(['claude-manager'], 1, {
      native,
      allowInputInjection: false,
    });
    expect(result).toBe('needs-terminal');
  });
});

describe('sendReplyToWarp', () => {
  it('types the reply and presses Enter', async () => {
    const native = fakeNative([{ id: '2', class: 'windowsterminal', title: 'claude-manager' }]);
    const result = await sendReplyToWarp(['claude-manager'], 'bora!', { native, delayMs: 0 });
    expect(native.typeText).toHaveBeenCalledWith('bora!', expect.anything());
    expect(native.sendKeys).toHaveBeenCalledWith('{ENTER}', expect.anything());
    expect(result).toBe('typed');
  });

  it('falls back to the clipboard when no terminal window exists', async () => {
    const native = fakeNative([]);
    const writeClipboard = vi.fn();
    const result = await sendReplyToWarp(['x'], 'texto', { native, writeClipboard });
    expect(writeClipboard).toHaveBeenCalledWith('texto');
    expect(result).toBe('clipboard');
  });
});
