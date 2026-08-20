import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  TERMINALS,
  focusChatTab,
  answerQuestionInWarp,
  sendReplyToWarp,
  wshBinary,
  resolveTty,
  terminalAppFocusScript,
  itermFocusScript,
} from '../src/main/terminal-darwin.js';
import { SessionRegistry } from '../src/main/session-registry.js';

const WAVE = { blockId: 'block-1', tabId: 'tab-1', jwt: 'jwt-1' };

function recorder(failOn = () => false) {
  const calls = [];
  const execFn = async (command, args, opts) => {
    calls.push({ command, args, opts });
    if (failOn(command, args)) throw new Error('exec failed');
    return { stdout: '' };
  };
  return { calls, execFn };
}

describe('focusChatTab (darwin)', () => {
  it('activates Wave and focuses the block via wsh with the captured env', async () => {
    const { calls, execFn } = recorder();
    const result = await focusChatTab([], { execFn, wave: WAVE });
    expect(result).toEqual({ focused: true, tabFound: true, matchedTitle: null });
    expect(calls[0].command).toBe('osascript');
    expect(calls[0].args[1]).toContain('"Wave" to activate');
    expect(calls[1].command).toBe('sqlite3'); // tab lookup, no keystroke without a hit
    expect(calls[2].args).toEqual(['focusblock', '-b', 'block-1']);
    expect(calls[2].opts.env).toMatchObject({
      WAVETERM_JWT: 'jwt-1',
      WAVETERM_TABID: 'tab-1',
      WAVETERM_BLOCKID: 'block-1',
    });
  });

  it('switches to the block tab with Cmd+n when it is not the active one', async () => {
    const workspaceRow = JSON.stringify({
      tabids: ['tab-0', 'tab-1', 'tab-2'],
      pinnedtabids: [],
      activetabid: 'tab-0',
    });
    const calls = [];
    const execFn = async (command, args, opts) => {
      calls.push({ command, args, opts });
      return { stdout: command === 'sqlite3' ? `${workspaceRow}\n` : '' };
    };
    const result = await focusChatTab([], { execFn, wave: WAVE });
    expect(result).toEqual({ focused: true, tabFound: true, matchedTitle: null });
    // tab-1 sits at visible index 1 → Cmd+2, then focusblock inside the tab
    expect(calls[2].args[1]).toBe(
      'tell application "System Events" to keystroke "2" using command down',
    );
    expect(calls[3].args).toEqual(['focusblock', '-b', 'block-1']);
  });

  it('skips the keystroke when the block tab is already active', async () => {
    const workspaceRow = JSON.stringify({
      tabids: ['tab-1', 'tab-2'],
      pinnedtabids: [],
      activetabid: 'tab-1',
    });
    const calls = [];
    const execFn = async (command, args, opts) => {
      calls.push({ command, args, opts });
      return { stdout: command === 'sqlite3' ? `${workspaceRow}\n` : '' };
    };
    await focusChatTab([], { execFn, wave: WAVE });
    expect(calls.some((call) => String(call.args?.[1]).includes('keystroke'))).toBe(false);
  });

  it('reports focused without tabFound when wsh fails', async () => {
    const { execFn } = recorder((command) => command !== 'osascript');
    const result = await focusChatTab([], { execFn, wave: WAVE });
    expect(result).toEqual({ focused: true, tabFound: false, matchedTitle: null });
  });

  it('only activates the configured terminal when there is no wave target', async () => {
    const { calls, execFn } = recorder();
    const result = await focusChatTab([], { execFn, terminal: 'iterm2' });
    expect(result.focused).toBe(true);
    expect(result.tabFound).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toContain('"iTerm" to activate');
  });

  it('does nothing on auto without a wave target', async () => {
    const { calls, execFn } = recorder();
    const result = await focusChatTab([], { execFn });
    expect(result.focused).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('skips wsh when a non-wave terminal is configured', async () => {
    const { calls, execFn } = recorder();
    const result = await focusChatTab([], { execFn, terminal: 'warp', wave: WAVE });
    expect(result.tabFound).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('exact focus via the captured terminal identity (darwin)', () => {
  it('selects the kitty tab through its CLI and activates the app', async () => {
    const { calls, execFn } = recorder();
    const result = await focusChatTab([], {
      execFn,
      term: { KITTY_WINDOW_ID: '3', KITTY_LISTEN_ON: 'unix:/tmp/kitty-sock' },
    });
    expect(result).toEqual({ focused: true, tabFound: true, matchedTitle: null });
    expect(calls[0].command).toBe('kitty');
    expect(calls[1].args[1]).toContain('"kitty" to activate');
  });

  it('outranks the configured terminal — the capture proves where the session lives', async () => {
    const { calls, execFn } = recorder();
    const result = await focusChatTab([], {
      execFn,
      terminal: 'warp',
      term: { WEZTERM_PANE: '7' },
    });
    expect(result.tabFound).toBe(true);
    expect(calls[0].command).toBe('wezterm');
    expect(calls[1].args[1]).toContain('"WezTerm" to activate');
  });
});

describe('tty tab hunt (darwin)', () => {
  // Emulates ps answering the tty and each app's AppleScript verdict.
  function ttyExec({ tty = 'ttys004', found = [] } = {}) {
    const calls = [];
    const execFn = async (command, args, opts) => {
      calls.push({ command, args, opts });
      if (command === 'ps') return { stdout: `${tty}\n` };
      if (command === 'osascript') {
        const app = args[1].includes('"Terminal"') ? 'terminal-app' : 'iterm2';
        return { stdout: found.includes(app) ? 'found\n' : 'missing\n' };
      }
      return { stdout: '' };
    };
    return { calls, execFn };
  }

  it('finds the Terminal.app tab whose tty is the claude process tty', async () => {
    const { calls, execFn } = ttyExec({ found: ['terminal-app'] });
    const result = await focusChatTab([], { execFn, sessionPid: 4242 });
    expect(result).toEqual({ focused: true, tabFound: true, matchedTitle: null });
    expect(calls[0]).toMatchObject({ command: 'ps', args: ['-o', 'tty=', '-p', '4242'] });
    expect(calls[1].args[1]).toContain('/dev/ttys004');
  });

  it('tries iTerm when the tab is not in Terminal.app', async () => {
    const { calls, execFn } = ttyExec({ found: ['iterm2'] });
    const result = await focusChatTab([], { execFn, sessionPid: 4242 });
    expect(result.tabFound).toBe(true);
    expect(calls[2].args[1]).toContain('"iTerm"');
  });

  it('respects a pinned terminal by only asking that app', async () => {
    const { calls, execFn } = ttyExec({ found: [] });
    const result = await focusChatTab([], { execFn, terminal: 'iterm2', sessionPid: 4242 });
    expect(result).toEqual({ focused: true, tabFound: false, matchedTitle: null });
    const scripts = calls.filter((call) => call.command === 'osascript');
    // one tty hunt in iTerm only, then the plain activate fallback
    expect(scripts).toHaveLength(2);
    expect(scripts[0].args[1]).toContain('"iTerm" is running');
    expect(scripts[1].args[1]).toContain('"iTerm" to activate');
  });

  it('skips the hunt when the process has no tty', async () => {
    const { calls, execFn } = ttyExec({ tty: '??' });
    const result = await focusChatTab([], { execFn, terminal: 'terminal-app', sessionPid: 4242 });
    expect(result.tabFound).toBe(false);
    expect(calls.filter((call) => call.command === 'osascript')).toHaveLength(1);
  });
});

describe('warp tab hunt (darwin)', () => {
  // Emulates System Events: the front window title advances on each
  // next-tab keystroke, exactly like a real terminal.
  function warpExec({ titles = [], exists = true } = {}) {
    const calls = [];
    let tabIndex = 0;
    const execFn = async (command, args) => {
      calls.push({ command, args });
      const script = String(args?.[1] ?? '');
      if (script.includes('exists process')) return { stdout: exists ? 'true\n' : 'false\n' };
      if (script.includes('keystroke "]"')) tabIndex += 1;
      if (script.includes('name of window')) {
        return { stdout: `${titles[Math.min(tabIndex, titles.length - 1)] ?? ''}\n` };
      }
      return { stdout: '' };
    };
    return { calls, execFn };
  }

  const keyPressesOf = (calls) =>
    calls.filter((call) => String(call.args?.[1]).includes('keystroke "]"'));

  it('cycles Warp tabs reading the front window title until it matches', async () => {
    const { calls, execFn } = warpExec({
      titles: ['aba-aleatoria', 'outra-aba', 'fix-exames — claude'],
    });
    const result = await focusChatTab('fix-exames', { execFn, terminal: 'warp', delayMs: 0 });
    expect(result).toEqual({
      focused: true,
      tabFound: true,
      matchedTitle: 'fix-exames — claude',
    });
    expect(keyPressesOf(calls)).toHaveLength(2);
  });

  it('hunts Warp on auto only when its process is running', async () => {
    const running = warpExec({ titles: ['fix-exames — claude'] });
    const result = await focusChatTab('fix-exames', {
      execFn: running.execFn,
      delayMs: 0,
    });
    expect(result.tabFound).toBe(true);

    const closed = warpExec({ exists: false });
    const missed = await focusChatTab('fix-exames', { execFn: closed.execFn, delayMs: 0 });
    expect(missed.focused).toBe(false);
    // the probe must be the only System Events touch — never a launch
    expect(closed.calls).toHaveLength(1);
  });

  it('reads the title but never presses keys when input injection is refused', async () => {
    const { calls, execFn } = warpExec({ titles: ['aba-a', 'fix-exames'] });
    const result = await focusChatTab('fix-exames', {
      execFn,
      terminal: 'warp',
      delayMs: 0,
      allowInputInjection: false,
    });
    expect(keyPressesOf(calls)).toHaveLength(0);
    expect(result.tabFound).toBe(false); // fell back to plain activation
    expect(result.focused).toBe(true);
  });

  it('stops after wrapping around and settles for activating Warp', async () => {
    const { calls, execFn } = warpExec({ titles: ['aba-a', 'aba-b', 'aba-a'] });
    const result = await focusChatTab('nao-existe', { execFn, terminal: 'warp', delayMs: 0 });
    expect(result).toEqual({ focused: true, tabFound: false, matchedTitle: null });
    expect(keyPressesOf(calls)).toHaveLength(2);
  });
});

describe('resolveTty', () => {
  it('prefixes /dev and trims', async () => {
    const execFn = async () => ({ stdout: 'ttys012\n' });
    expect(await resolveTty(10, { execFn })).toBe('/dev/ttys012');
  });

  it('returns null without a controlling tty, a pid, or ps', async () => {
    expect(await resolveTty(10, { execFn: async () => ({ stdout: '??\n' }) })).toBe(null);
    expect(await resolveTty(null, { execFn: async () => ({ stdout: 'ttys1\n' }) })).toBe(null);
    expect(
      await resolveTty(10, {
        execFn: async () => {
          throw new Error('no ps');
        },
      }),
    ).toBe(null);
  });
});

describe('tty focus scripts', () => {
  it('guard against launching the app and hunt by tty', () => {
    const script = terminalAppFocusScript('/dev/ttys004');
    expect(script).toContain('if application "Terminal" is running');
    expect(script).toContain('if tty of t is "/dev/ttys004"');
    const iterm = itermFocusScript('/dev/ttys004');
    expect(iterm).toContain('if application "iTerm" is running');
    expect(iterm).toContain('if tty of s is "/dev/ttys004"');
  });

  it('refuses a tty that could escape the AppleScript string', () => {
    expect(() => terminalAppFocusScript('/dev/ttys0" & (do shell script "id")')).toThrow(/bad tty/);
    expect(() => itermFocusScript('not-a-tty')).toThrow(/bad tty/);
  });
});

describe('answerQuestionInWarp (darwin)', () => {
  it('presses Down per option and Return only when the block was focused', async () => {
    const { calls, execFn } = recorder();
    const result = await answerQuestionInWarp([], 2, { execFn, delayMs: 0, wave: WAVE });
    expect(result).toBe('answered');
    const keys = calls.slice(3).map((call) => call.args[1]);
    expect(keys).toEqual([
      'tell application "System Events" to key code 125',
      'tell application "System Events" to key code 125',
      'tell application "System Events" to key code 36',
    ]);
  });

  it('returns not-found without a wave target', async () => {
    const { calls, execFn } = recorder();
    const result = await answerQuestionInWarp([], 1, { execFn, delayMs: 0 });
    expect(result).toBe('not-found');
    expect(calls).toHaveLength(0);
  });
});

describe('sendReplyToWarp (darwin)', () => {
  it('types the reply and hits Return when the block was focused', async () => {
    const { calls, execFn } = recorder();
    const result = await sendReplyToWarp([], 'pode seguir "assim"', {
      execFn,
      delayMs: 0,
      wave: WAVE,
      writeClipboard: () => {},
    });
    expect(result).toBe('typed');
    expect(calls[3].args[1]).toBe(
      'tell application "System Events" to keystroke "pode seguir \\"assim\\""',
    );
    expect(calls[4].args[1]).toContain('key code 36');
  });

  it('falls back to the clipboard when the block is unreachable', async () => {
    let copied = null;
    const { execFn } = recorder();
    const result = await sendReplyToWarp([], 'oi', {
      execFn,
      delayMs: 0,
      writeClipboard: (value) => {
        copied = value;
      },
    });
    expect(result).toBe('clipboard');
    expect(copied).toBe('oi');
  });

  it('falls back to the clipboard when typing fails', async () => {
    let copied = null;
    const failOnKeystroke = (command, args) =>
      command === 'osascript' && args[1].includes('keystroke');
    const { execFn } = recorder(failOnKeystroke);
    const result = await sendReplyToWarp([], 'oi', {
      execFn,
      delayMs: 0,
      wave: WAVE,
      writeClipboard: (value) => {
        copied = value;
      },
    });
    expect(result).toBe('clipboard');
    expect(copied).toBe('oi');
  });
});

describe('darwin terminal metadata', () => {
  it('exposes labels for every terminal option', () => {
    for (const spec of Object.values(TERMINALS)) expect(spec.label).toBeTruthy();
  });

  it('prefers the bundled wsh binary when present', () => {
    expect(wshBinary(() => true)).toContain(path.join('waveterm', 'bin', 'wsh'));
    expect(wshBinary(() => false)).toBe('wsh');
  });
});

describe('session wave metadata', () => {
  it('stores the wave target from hook events', () => {
    const registry = new SessionRegistry();
    const session = registry.applyEvent({
      hook_event_name: 'UserPromptSubmit',
      session_id: 's1',
      cwd: '/tmp/projeto',
      wave: WAVE,
    });
    expect(session.wave).toEqual(WAVE);
    registry.applyEvent({ hook_event_name: 'Stop', session_id: 's1' });
    expect(registry.sessions.get('s1').wave).toEqual(WAVE);
  });
});
