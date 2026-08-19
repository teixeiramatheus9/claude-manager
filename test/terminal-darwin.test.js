import { describe, expect, it } from 'vitest';
import {
  TERMINALS,
  focusChatTab,
  answerQuestionInWarp,
  sendReplyToWarp,
  wshBinary,
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
    expect(calls[1].args).toEqual(['focusblock', '-b', 'block-1']);
    expect(calls[1].opts.env).toMatchObject({
      WAVETERM_JWT: 'jwt-1',
      WAVETERM_TABID: 'tab-1',
      WAVETERM_BLOCKID: 'block-1',
    });
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

describe('answerQuestionInWarp (darwin)', () => {
  it('presses Down per option and Return only when the block was focused', async () => {
    const { calls, execFn } = recorder();
    const result = await answerQuestionInWarp([], 2, { execFn, delayMs: 0, wave: WAVE });
    expect(result).toBe('answered');
    const keys = calls.slice(2).map((call) => call.args[1]);
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
    expect(calls[2].args[1]).toBe(
      'tell application "System Events" to keystroke "pode seguir \\"assim\\""',
    );
    expect(calls[3].args[1]).toContain('key code 36');
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
    expect(wshBinary(() => true)).toContain('waveterm/bin/wsh');
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
