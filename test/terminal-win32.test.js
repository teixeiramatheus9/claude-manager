import { describe, it, expect, vi } from 'vitest';
import {
  TERMINALS,
  focusChatTab,
  answerQuestionInWarp,
  sendReplyToWarp,
} from '../src/main/terminal-win32.js';

function fakeNative(
  windows,
  { titles = [], ancestors = [], foregroundRefused = false, tabs = null } = {},
) {
  let titleCall = 0;
  let activated = null;
  return {
    // one-pass walk: index → tab title, the fast route
    readTabTitles: vi.fn().mockResolvedValue(tabs ?? []),
    listWindows: vi.fn().mockResolvedValue(windows),
    listProcessAncestors: vi.fn().mockResolvedValue(ancestors),
    activateWindow: vi.fn().mockImplementation(async (id) => {
      activated = id;
    }),
    // Windows may refuse SetForegroundWindow: then the window in front is
    // someone else's, and injected keys would land there.
    getForegroundWindow: vi.fn().mockImplementation(async () =>
      foregroundRefused ? '999999' : activated,
    ),
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
      windowId: '2', // the injection sites re-check this window holds focus
      tabIndex: undefined,
      via: 'active-tab',
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

describe('typing still works on the routes that identify no window', () => {
  // The deep link and wsh focus a tab without ever enumerating windows, so
  // there is no windowId to compare the foreground against. Refusing to type
  // there would make the fastest route the one route that cannot answer.
  it('answers after the warp url when a terminal window holds the foreground', async () => {
    const native = fakeNative([{ id: '7', pid: 10, class: 'warp', title: 'chat' }]);
    native.getForegroundWindow = vi.fn().mockResolvedValue('7');
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const result = await answerQuestionInWarp(['chat'], 1, {
      native,
      openUrl,
      delayMs: 0,
      term: { WARP_TERMINAL_SESSION_UUID: 'abc123' },
    });
    expect(result).toBe('answered');
    expect(native.sendKeys).toHaveBeenCalledWith('{ENTER}', expect.anything());
  });

  it('refuses to type when something else holds the foreground after the url', async () => {
    const native = fakeNative([{ id: '7', pid: 10, class: 'warp', title: 'chat' }]);
    native.getForegroundWindow = vi.fn().mockResolvedValue('999999'); // a browser
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const result = await answerQuestionInWarp(['chat'], 1, {
      native,
      openUrl,
      delayMs: 0,
      term: { WARP_TERMINAL_SESSION_UUID: 'abc123' },
    });
    expect(native.sendKeys).not.toHaveBeenCalled();
    expect(result).toBe('not-found');
  });
});

describe('the early warp branch only claims what the url actually did', () => {
  it('does not short-circuit when the url failed and another CLI selected the pane', async () => {
    // openUrl rejects, so selectExactTab falls through to wezterm: that only
    // selects the pane — the window still has to be raised on Windows.
    const native = fakeNative([{ id: '3', pid: 10, class: 'wezterm-gui', title: 'chat' }]);
    const openUrl = vi.fn().mockRejectedValue(new Error('no handler'));
    const execFn = vi.fn().mockResolvedValue({ stdout: '' });
    const result = await focusChatTab(['nao-casa-com-nada'], {
      native,
      openUrl,
      execFn,
      term: { WARP_TERMINAL_SESSION_UUID: 'abc123', WEZTERM_PANE: '7' },
    });
    expect(native.activateWindow).toHaveBeenCalledWith('3', expect.anything());
    expect(result).toMatchObject({ tabFound: true, windowId: '3' });
  });

  it('selects through the terminal CLI only once', async () => {
    const native = fakeNative([{ id: '3', pid: 10, class: 'wezterm-gui', title: 'chat' }]);
    const openUrl = vi.fn().mockRejectedValue(new Error('no handler'));
    const execFn = vi.fn().mockResolvedValue({ stdout: '' });
    await focusChatTab(['nao-casa'], {
      native,
      openUrl,
      execFn,
      term: { WARP_TERMINAL_SESSION_UUID: 'abc123', WEZTERM_PANE: '7' },
    });
    const wezCalls = execFn.mock.calls.filter(([command]) => command === 'wezterm');
    expect(wezCalls).toHaveLength(1);
  });
});

describe('warp url: straight to the tab, no window work at all', () => {
  it('opens the session url and skips listing windows entirely', async () => {
    const native = fakeNative([{ id: '7', pid: 10, class: 'warp', title: 'outra-aba' }]);
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const result = await focusChatTab(['claude-manager'], {
      native,
      openUrl,
      term: { WARP_TERMINAL_SESSION_UUID: 'abc123' },
    });
    expect(openUrl).toHaveBeenCalledWith('warp://session/abc123');
    expect(native.listWindows).not.toHaveBeenCalled();
    expect(native.sendKeys).not.toHaveBeenCalled();
    expect(native.readTabTitles).not.toHaveBeenCalled();
    expect(result).toMatchObject({ focused: true, tabFound: true, via: 'warp' });
  });

  it('falls back to the window hunt when the url has no handler', async () => {
    const native = fakeNative([{ id: '7', pid: 10, class: 'warp', title: 'claude-manager' }]);
    const openUrl = vi.fn().mockRejectedValue(new Error('no handler'));
    const result = await focusChatTab(['claude-manager'], {
      native,
      openUrl,
      term: { WARP_TERMINAL_SESSION_UUID: 'abc123' },
    });
    expect(native.listWindows).toHaveBeenCalled();
    expect(result.tabFound).toBe(true);
  });
});

describe('jumping straight to the tab by index', () => {
  const warpWindow = [{ id: '7', pid: 10, class: 'warp', title: 'outra-aba' }];
  const threeTabs = [
    { index: 1, title: 'outra-aba' },
    { index: 2, title: 'claude-manager — claude' },
    { index: 3, title: 'terceira' },
  ];

  it('walks the tabs once, then jumps to the matching index', async () => {
    const native = fakeNative(warpWindow, { titles: ['outra-aba'], tabs: threeTabs });
    const result = await focusChatTab(['claude-manager'], {
      native,
      delayMs: 0,
      terminal: 'warp',
    });
    expect(native.readTabTitles).toHaveBeenCalledTimes(1);
    // Ctrl+2 straight to it — no Ctrl+Tab parade
    expect(native.sendKeys).toHaveBeenCalledWith('^2', expect.anything());
    expect(native.sendKeys.mock.calls.map(([keys]) => keys)).not.toContain('^{TAB}');
    expect(result).toMatchObject({ tabFound: true, tabIndex: 2, via: 'jump-walk' });
  });

  it('uses a remembered index without walking the tabs again', async () => {
    // active tab is another one; after the jump the chat's title shows up
    const native = fakeNative(warpWindow, {
      titles: ['outra-aba', 'claude-manager — claude'],
      tabs: threeTabs,
    });
    const result = await focusChatTab(['claude-manager'], {
      native,
      delayMs: 0,
      terminal: 'warp',
      tabIndex: 2,
    });
    expect(native.sendKeys).toHaveBeenCalledWith('^2', expect.anything());
    expect(native.readTabTitles).not.toHaveBeenCalled();
    expect(result).toMatchObject({ tabFound: true, tabIndex: 2, via: 'jump-cached' });
  });

  it('walks the tabs when the remembered index no longer holds that chat', async () => {
    // tab 2 now shows something else; the walk finds the chat at index 3
    const native = fakeNative(warpWindow, {
      titles: ['outra-coisa'],
      tabs: [
        { index: 1, title: 'outra-aba' },
        { index: 2, title: 'outra-coisa' },
        { index: 3, title: 'claude-manager — claude' },
      ],
    });
    const result = await focusChatTab(['claude-manager'], {
      native,
      delayMs: 0,
      terminal: 'warp',
      tabIndex: 2,
    });
    expect(native.readTabTitles).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ tabFound: true, tabIndex: 3 });
  });

  it('returns to the original tab when no tab holds the chat', async () => {
    const native = fakeNative(warpWindow, { titles: ['terceira'], tabs: threeTabs });
    const result = await focusChatTab(['inexistente-xyz'], {
      native,
      delayMs: 0,
      terminal: 'warp',
    });
    // 'terceira' was active before the walk — the user is put back there
    expect(native.sendKeys).toHaveBeenLastCalledWith('^3', expect.anything());
    expect(result).toMatchObject({ tabFound: false });
  });

  it('still cycles with Ctrl+Tab on terminals with no jump shortcut', async () => {
    const native = fakeNative([{ id: '9', pid: 10, class: 'conhost', title: 'nope' }], {
      titles: ['nope', 'claude-manager — claude'],
    });
    const result = await focusChatTab(['claude-manager'], { native, delayMs: 0 });
    expect(native.readTabTitles).not.toHaveBeenCalled();
    expect(native.sendKeys).toHaveBeenCalledWith('^{TAB}', expect.anything());
    expect(result.tabFound).toBe(true);
  });
});

describe('never types into a window that is not in front', () => {
  it('skips tab cycling when the terminal did not take the foreground', async () => {
    // Windows refuses SetForegroundWindow while another app holds focus —
    // Ctrl+Tab would then reach THAT app (a browser losing its tabs).
    const native = fakeNative([{ id: '5', class: 'warp', title: 'outra-aba' }], {
      titles: ['outra-aba', 'claude-manager — claude'],
      foregroundRefused: true,
    });
    const result = await focusChatTab(['claude-manager'], { native, delayMs: 0 });
    expect(native.sendKeys).not.toHaveBeenCalled();
    expect(result).toMatchObject({ tabFound: false, cause: 'focus-refused' });
  });

  it('does not answer a question when the foreground is someone else', async () => {
    const native = fakeNative([{ id: '2', class: 'windowsterminal', title: 'claude-manager' }], {
      foregroundRefused: true,
    });
    const result = await answerQuestionInWarp(['claude-manager'], 2, { native, delayMs: 0 });
    expect(native.sendKeys).not.toHaveBeenCalled();
    expect(result).toBe('not-found');
  });

  it('falls back to the clipboard instead of typing into the wrong window', async () => {
    const native = fakeNative([{ id: '2', class: 'windowsterminal', title: 'claude-manager' }], {
      foregroundRefused: true,
    });
    const writeClipboard = vi.fn();
    const result = await sendReplyToWarp(['claude-manager'], 'texto', {
      native,
      writeClipboard,
      delayMs: 0,
    });
    expect(native.typeText).not.toHaveBeenCalled();
    expect(writeClipboard).toHaveBeenCalledWith('texto');
    expect(result).toBe('clipboard');
  });
});

describe('window scoping by session pid', () => {
  it('keeps every window of the owning process, not just the first', async () => {
    // Warp hosts all its windows under one pid: narrowing to a single window
    // would throw away the sibling whose tab actually holds the chat.
    const native = fakeNative(
      [
        { id: '1', pid: 200, class: 'warp', title: 'projeto-outro' },
        { id: '2', pid: 200, class: 'warp', title: 'claude-manager — claude' },
      ],
      { ancestors: [500, 200] },
    );
    const result = await focusChatTab(['claude-manager'], { native, sessionPid: 500 });
    expect(native.activateWindow).toHaveBeenCalledWith('2', expect.anything());
    expect(result.tabFound).toBe(true);
  });

  it('prefers the window whose process hosts the session over a title match elsewhere', async () => {
    // claude (pid 500) runs under the warp window's process (pid 200): the
    // OTHER warp window matching by title must lose to the proven owner.
    const native = fakeNative(
      [
        { id: '1', pid: 100, class: 'warp', title: 'claude-manager — claude' },
        { id: '2', pid: 200, class: 'warp', title: 'claude-manager — claude' },
      ],
      { ancestors: [500, 350, 200] },
    );
    const result = await focusChatTab(['claude-manager'], { native, sessionPid: 500 });
    expect(native.listProcessAncestors).toHaveBeenCalledWith(500, expect.anything());
    expect(native.activateWindow).toHaveBeenCalledWith('2', expect.anything());
    expect(result.tabFound).toBe(true);
  });

  it('cycles tabs only inside the session window', async () => {
    const native = fakeNative(
      [
        { id: '1', pid: 100, class: 'windowsterminal', title: 'nope-a' },
        { id: '2', pid: 200, class: 'windowsterminal', title: 'nope-b' },
      ],
      { titles: ['nope-b', 'claude-manager — claude'], ancestors: [500, 200] },
    );
    const result = await focusChatTab(['claude-manager'], {
      native,
      sessionPid: 500,
      delayMs: 0,
    });
    expect(native.activateWindow).toHaveBeenCalledTimes(1);
    expect(native.activateWindow).toHaveBeenCalledWith('2', expect.anything());
    expect(result.tabFound).toBe(true);
  });

  it('focuses the session window even when no tab title ever matches', async () => {
    const native = fakeNative(
      [
        { id: '1', pid: 100, class: 'warp', title: 'tab-a' },
        { id: '2', pid: 200, class: 'warp', title: 'tab-b' },
      ],
      { titles: ['tab-b', 'tab-b'], ancestors: [500, 200] },
    );
    const result = await focusChatTab(['sem-match'], { native, sessionPid: 500, delayMs: 0 });
    // the scoped hunt must never touch the other window
    expect(native.activateWindow.mock.calls.every(([id]) => id === '2')).toBe(true);
    expect(native.activateWindow).toHaveBeenCalledWith('2', expect.anything());
    expect(result).toMatchObject({ focused: true, tabFound: false });
  });

  it('falls back to the full hunt when the pid maps to no listed window', async () => {
    const native = fakeNative(
      [{ id: '1', pid: 100, class: 'windowsterminal', title: 'claude-manager — claude' }],
      { ancestors: [500, 999] },
    );
    const result = await focusChatTab(['claude-manager'], { native, sessionPid: 500 });
    expect(native.activateWindow).toHaveBeenCalledWith('1', expect.anything());
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
