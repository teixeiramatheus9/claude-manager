import { describe, it, expect } from 'vitest';
import {
  parseWindowList,
  pickTargetWindow,
  titleMatchesKeys,
  focusChatTab,
  focusWarpWindow,
  sendReplyToWarp,
  answerQuestionInWarp,
} from '../src/main/warp.js';

const WMCTRL_OUTPUT = [
  '0x03a00003  0 gnome-terminal-server.Gnome-terminal  host Terminal',
  '0x04c00007  0 dev.warp.Warp.dev.warp.Warp    host projeto-alpha — claude',
  '0x04c00042  0 dev.warp.Warp.dev.warp.Warp    host Claude Manager — npm start',
  '',
].join('\n');

function fakeExec({ failOn = [] } = {}) {
  const calls = [];
  const execFn = async (command, args) => {
    calls.push({ command, args });
    if (failOn.includes(command)) throw new Error(`${command} failed`);
    if (command === 'wmctrl' && args[0] === '-lx') return { stdout: WMCTRL_OUTPUT };
    return { stdout: '' };
  };
  return { execFn, calls };
}

describe('parseWindowList', () => {
  it('parses ids, classes and titles', () => {
    const windows = parseWindowList(WMCTRL_OUTPUT);
    expect(windows).toHaveLength(3);
    expect(windows[1]).toEqual({
      id: '0x04c00007',
      wmClass: 'dev.warp.Warp.dev.warp.Warp',
      title: 'projeto-alpha — claude',
    });
  });
});

describe('pickTargetWindow', () => {
  const windows = parseWindowList(WMCTRL_OUTPUT);

  it('prefers the warp window whose title matches the project name', () => {
    expect(pickTargetWindow(windows, 'Claude Manager').id).toBe('0x04c00042');
  });

  it('falls back to ANY terminal whose title matches when no warp title does', () => {
    const mixed = parseWindowList(
      [
        '0x1 0 dev.warp.Warp.dev.warp.Warp host outra-coisa',
        '0x2 0 gnome-terminal-server.Gnome-terminal host fix-exames — claude',
      ].join('\n'),
    );
    expect(pickTargetWindow(mixed, 'fix-exames').id).toBe('0x2');
  });

  it('falls back to the first warp window when nothing matches', () => {
    expect(pickTargetWindow(windows, 'outro-projeto').id).toBe('0x04c00007');
  });

  it('returns null when there is no warp nor matching window', () => {
    expect(pickTargetWindow(parseWindowList('0x1 0 x.X host t'), 'x')).toBeNull();
  });

  it('never picks non-terminal windows even when their title matches', () => {
    const mixed = parseWindowList(
      [
        '0x1 0 google-chrome.Google-chrome host PR do projeto-alpha - Google Chrome',
        '0x2 0 claude-manager.claude-manager host claude-manager',
        '0x3 0 dev.warp.Warp.dev.warp.Warp host outra-aba',
      ].join('\n'),
    );
    expect(pickTargetWindow(mixed, 'projeto-alpha').id).toBe('0x3');
    expect(pickTargetWindow(mixed, 'claude-manager').id).toBe('0x3');
  });
});

describe('focusWarpWindow', () => {
  it('activates the picked window', async () => {
    const { execFn, calls } = fakeExec();
    expect(await focusWarpWindow('projeto-alpha', execFn)).toBe(true);
    expect(calls[1]).toEqual({ command: 'wmctrl', args: ['-ia', '0x04c00007'] });
  });

  it('returns false when wmctrl is unavailable', async () => {
    const { execFn } = fakeExec({ failOn: ['wmctrl'] });
    expect(await focusWarpWindow('x', execFn)).toBe(false);
  });
});

describe('focusChatTab', () => {
  function tabCyclingExec(titles) {
    const calls = [];
    const titleQueue = [...titles];
    const execFn = async (command, args) => {
      calls.push({ command, args });
      if (command === 'wmctrl' && args[0] === '-lx') {
        return { stdout: '0x9 0 dev.warp.Warp.dev.warp.Warp host aba-aleatoria\n' };
      }
      if (command === 'xdotool' && args[0] === 'getwindowname') {
        return { stdout: titleQueue.length > 1 ? titleQueue.shift() : titleQueue[0] };
      }
      return { stdout: '' };
    };
    return { execFn, calls };
  }

  it('cycles tabs with ctrl+Tab until the title matches the chat', async () => {
    const { execFn, calls } = tabCyclingExec(['aba-aleatoria', 'outra-aba', 'fix-exames — claude']);
    const result = await focusChatTab('fix-exames', { execFn, delayMs: 0 });
    expect(result).toEqual({ focused: true, tabFound: true, matchedTitle: 'fix-exames — claude' });
    const tabPresses = calls.filter(
      (call) => call.command === 'xdotool' && call.args[0] === 'key',
    );
    expect(tabPresses).toHaveLength(2);
  });

  it('stops after wrapping around and reports the tab as not found', async () => {
    const { execFn, calls } = tabCyclingExec(['aba-a', 'aba-b', 'aba-a']);
    const result = await focusChatTab('nao-existe', { execFn, delayMs: 0 });
    expect(result).toEqual({ focused: true, tabFound: false, matchedTitle: null });
    const tabPresses = calls.filter(
      (call) => call.command === 'xdotool' && call.args[0] === 'key',
    );
    expect(tabPresses).toHaveLength(2);
  });

  it('skips tab hunting entirely on a direct title match', async () => {
    const { execFn, calls } = fakeExec();
    const result = await focusChatTab('Claude Manager', { execFn, delayMs: 0 });
    expect(result).toEqual({
      focused: true,
      tabFound: true,
      matchedTitle: 'Claude Manager — npm start',
    });
    expect(calls.some((call) => call.command === 'xdotool')).toBe(false);
  });
});

describe('titleMatchesKeys', () => {
  it('matches ignoring accents', () => {
    expect(titleMatchesKeys('✳ Correção de exames', ['correcao de exames'])).toBe(true);
  });

  it('matches when two significant words of a key appear in the title', () => {
    expect(
      titleMatchesKeys('✳ Corrigir erro de tooltip indefinido', [
        'corrige o bug do tooltip indefinido no front',
      ]),
    ).toBe(true);
  });

  it('does not match on a single incidental word', () => {
    expect(titleMatchesKeys('✳ Corrigir erro de layout', ['corrige o bug do tooltip'])).toBe(
      false,
    );
  });
});

describe('answerQuestionInWarp', () => {
  it('presses Down x index then Return when the tab was found', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('projeto-alpha', 2, { execFn, delayMs: 0 });
    expect(result).toBe('answered');
    const keyPresses = calls
      .filter((call) => call.command === 'xdotool' && call.args[0] === 'key')
      .map((call) => call.args[2]);
    expect(keyPresses).toEqual(['Down', 'Down', 'Return']);
  });

  it('answers the first option with Return only', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('projeto-alpha', 0, { execFn, delayMs: 0 });
    expect(result).toBe('answered');
    const keyPresses = calls
      .filter((call) => call.command === 'xdotool' && call.args[0] === 'key')
      .map((call) => call.args[2]);
    expect(keyPresses).toEqual(['Return']);
  });

  it('refuses to press keys when the tab was not found', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('chat-inexistente-xyz', 1, { execFn, delayMs: 0 });
    expect(result).toBe('not-found');
    // it may cycle tabs while hunting (ctrl+Tab), but never answers
    const answerPresses = calls.filter(
      (call) =>
        call.command === 'xdotool' &&
        call.args[0] === 'key' &&
        ['Down', 'Return'].includes(call.args[2]),
    );
    expect(answerPresses).toHaveLength(0);
  });
});

describe('sendReplyToWarp', () => {
  it('types the reply plus Return into the focused warp window', async () => {
    const { execFn, calls } = fakeExec();
    const mode = await sendReplyToWarp('projeto-alpha', 'pode seguir', {
      execFn,
      writeClipboard: () => {},
      delayMs: 0,
    });
    expect(mode).toBe('typed');
    const xdotoolCalls = calls.filter((call) => call.command === 'xdotool');
    expect(xdotoolCalls[0].args).toContain('pode seguir');
    expect(xdotoolCalls[1].args).toEqual(['key', 'Return']);
  });

  it('falls back to the clipboard when typing fails', async () => {
    const { execFn } = fakeExec({ failOn: ['xdotool'] });
    let copied = null;
    const mode = await sendReplyToWarp('projeto-alpha', 'resposta', {
      execFn,
      writeClipboard: (text) => {
        copied = text;
      },
      delayMs: 0,
    });
    expect(mode).toBe('clipboard');
    expect(copied).toBe('resposta');
  });

  it('copies to clipboard when no warp window exists at all', async () => {
    const { execFn } = fakeExec({ failOn: ['wmctrl'] });
    let copied = null;
    const mode = await sendReplyToWarp('x', 'resposta', {
      execFn,
      writeClipboard: (text) => {
        copied = text;
      },
      delayMs: 0,
    });
    expect(mode).toBe('clipboard');
    expect(copied).toBe('resposta');
  });

  it('returns failed when even the clipboard blows up', async () => {
    const { execFn } = fakeExec({ failOn: ['wmctrl'] });
    const mode = await sendReplyToWarp('x', 'resposta', {
      execFn,
      writeClipboard: () => {
        throw new Error('no clipboard');
      },
      delayMs: 0,
    });
    expect(mode).toBe('failed');
  });
});
