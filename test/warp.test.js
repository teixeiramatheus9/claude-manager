import { describe, it, expect } from 'vitest';
import {
  listWindows,
  pickTargetWindow,
  titleMatchesKeys,
  focusChatTab,
  focusWarpWindow,
  sendReplyToWarp,
  answerQuestionInWarp,
  TERMINALS,
} from '../src/main/warp.js';

const DEFAULT_WINDOWS = [
  { id: '0x03a00003', wmClass: 'gnome-terminal-server.Gnome-terminal', title: 'Terminal' },
  { id: '0x04c00007', wmClass: 'dev.warp.Warp', title: 'projeto-alpha — claude' },
  { id: '0x04c00042', wmClass: 'dev.warp.Warp', title: 'Claude Manager — npm start' },
];

// Emulates xdotool: `search` lists ids, then class and title are one query each.
// When tabTitles is given, the title returned by getwindowname advances on every
// next-tab keypress — which is exactly how a real terminal behaves, since the
// window title follows the active tab.
function fakeExec({ windows = DEFAULT_WINDOWS, failOn = [], failOnAction = [], tabTitles = null } = {}) {
  const calls = [];
  let tabIndex = 0;
  const execFn = async (command, args) => {
    calls.push({ command, args });
    if (failOn.includes(command)) throw new Error(`${command} failed`);
    if (failOnAction.includes(args[0])) throw new Error(`${command} ${args[0]} failed`);
    if (command !== 'xdotool') return { stdout: '' };

    const [action, target] = args;
    if (action === 'search') return { stdout: windows.map((window) => window.id).join('\n') };
    if (action === 'getwindowclassname') {
      return { stdout: windows.find((window) => window.id === target)?.wmClass ?? '' };
    }
    if (action === 'getwindowname') {
      if (tabTitles) return { stdout: tabTitles[Math.min(tabIndex, tabTitles.length - 1)] };
      return { stdout: windows.find((window) => window.id === target)?.title ?? '' };
    }
    if (action === 'key' && tabTitles) tabIndex += 1;
    return { stdout: '' };
  };
  return { execFn, calls };
}

const keyPressesOf = (calls) =>
  calls.filter((call) => call.command === 'xdotool' && call.args[0] === 'key');

describe('listWindows', () => {
  it('pairs each id with its class and title', async () => {
    const { execFn } = fakeExec({
      windows: [
        { id: '111', wmClass: 'dev.warp.Warp', title: 'projeto-x' },
        { id: '222', wmClass: 'ptyxis', title: 'user@host:~' },
      ],
    });
    expect(await listWindows({ execFn })).toEqual([
      { id: '111', wmClass: 'dev.warp.Warp', title: 'projeto-x' },
      { id: '222', wmClass: 'ptyxis', title: 'user@host:~' },
    ]);
  });

  it('skips windows that vanish between the search and the query', async () => {
    const execFn = async (_command, args) => {
      if (args[0] === 'search') return { stdout: '111\n222' };
      if (args[1] === '222') throw new Error('window vanished');
      if (args[0] === 'getwindowclassname') return { stdout: 'ptyxis' };
      return { stdout: 'titulo' };
    };
    expect(await listWindows({ execFn })).toEqual([
      { id: '111', wmClass: 'ptyxis', title: 'titulo' },
    ]);
  });

  it('returns an empty list when xdotool is missing', async () => {
    const { execFn } = fakeExec({ failOn: ['xdotool'] });
    expect(await listWindows({ execFn })).toEqual([]);
  });
});

describe('TERMINALS', () => {
  // Fedora 41+ ships Ptyxis as the default terminal; without this entry the
  // distro default is not even selectable in the settings panel.
  it('includes ptyxis', () => {
    expect(TERMINALS.ptyxis).toMatchObject({ classHint: 'ptyxis', hasTabs: true });
    expect(typeof TERMINALS.ptyxis.nextTabKey).toBe('string');
  });
});

describe('pickTargetWindow', () => {
  it('prefers the warp window whose title matches the project name', () => {
    expect(pickTargetWindow(DEFAULT_WINDOWS, 'Claude Manager').id).toBe('0x04c00042');
  });

  it('falls back to ANY terminal whose title matches when no warp title does', () => {
    const mixed = [
      { id: '0x1', wmClass: 'dev.warp.Warp', title: 'outra-coisa' },
      { id: '0x2', wmClass: 'gnome-terminal-server.Gnome-terminal', title: 'fix-exames — claude' },
    ];
    expect(pickTargetWindow(mixed, 'fix-exames').id).toBe('0x2');
  });

  it('falls back to the first warp window when nothing matches', () => {
    expect(pickTargetWindow(DEFAULT_WINDOWS, 'outro-projeto').id).toBe('0x04c00007');
  });

  it('returns null when there is no warp nor matching window', () => {
    expect(pickTargetWindow([{ id: '0x1', wmClass: 'x.X', title: 't' }], 'x')).toBeNull();
  });

  it('never picks non-terminal windows even when their title matches', () => {
    const mixed = [
      { id: '0x1', wmClass: 'google-chrome.Google-chrome', title: 'PR do projeto-alpha - Chrome' },
      { id: '0x2', wmClass: 'claude-manager.claude-manager', title: 'claude-manager' },
      { id: '0x3', wmClass: 'dev.warp.Warp', title: 'outra-aba' },
    ];
    expect(pickTargetWindow(mixed, 'projeto-alpha').id).toBe('0x3');
    expect(pickTargetWindow(mixed, 'claude-manager').id).toBe('0x3');
  });
});

describe('focusWarpWindow', () => {
  it('activates the picked window', async () => {
    const { execFn, calls } = fakeExec();
    expect(await focusWarpWindow('projeto-alpha', execFn)).toBe(true);
    expect(calls).toEqual(
      expect.arrayContaining([
        { command: 'xdotool', args: ['windowactivate', '0x04c00007'] },
      ]),
    );
  });

  it('returns false when xdotool is unavailable', async () => {
    const { execFn } = fakeExec({ failOn: ['xdotool'] });
    expect(await focusWarpWindow('x', execFn)).toBe(false);
  });
});

describe('focusChatTab', () => {
  it('cycles tabs with the next-tab key until the title matches the chat', async () => {
    const { execFn, calls } = fakeExec({
      windows: [{ id: '0x9', wmClass: 'dev.warp.Warp', title: 'aba-aleatoria' }],
      tabTitles: ['aba-aleatoria', 'outra-aba', 'fix-exames — claude'],
    });
    const result = await focusChatTab('fix-exames', { execFn, delayMs: 0 });
    expect(result).toEqual({
      focused: true,
      tabFound: true,
      matchedTitle: 'fix-exames — claude',
      cause: null,
    });
    expect(keyPressesOf(calls)).toHaveLength(2);
  });

  it('stops after wrapping around and reports the tab as not found', async () => {
    const { execFn, calls } = fakeExec({
      windows: [{ id: '0x9', wmClass: 'dev.warp.Warp', title: 'aba-a' }],
      tabTitles: ['aba-a', 'aba-b', 'aba-a'],
    });
    const result = await focusChatTab('nao-existe', { execFn, delayMs: 0 });
    expect(result).toEqual({ focused: true, tabFound: false, matchedTitle: null, cause: null });
    expect(keyPressesOf(calls)).toHaveLength(2);
  });

  it('skips tab hunting entirely on a direct title match', async () => {
    const { execFn, calls } = fakeExec();
    const result = await focusChatTab('Claude Manager', { execFn, delayMs: 0 });
    expect(result).toEqual({
      focused: true,
      tabFound: true,
      matchedTitle: 'Claude Manager — npm start',
      cause: null,
    });
    expect(keyPressesOf(calls)).toHaveLength(0);
  });

  // Named causes replace the old silent catch, so the panel can tell the user
  // whether xdotool is missing or the terminal is simply invisible to X.
  it('reports no-x-windows when nothing is listable', async () => {
    const { execFn } = fakeExec({ failOn: ['xdotool'] });
    const result = await focusChatTab('qualquer', { execFn, delayMs: 0 });
    expect(result).toEqual({
      focused: false,
      tabFound: false,
      matchedTitle: null,
      cause: 'no-x-windows',
    });
  });

  it('reports terminal-not-in-x when no window is a terminal', async () => {
    const { execFn } = fakeExec({
      windows: [{ id: '0x1', wmClass: 'firefox', title: 'nada a ver' }],
    });
    const result = await focusChatTab('qualquer', { execFn, delayMs: 0 });
    expect(result).toEqual({
      focused: false,
      tabFound: false,
      matchedTitle: null,
      cause: 'terminal-not-in-x',
    });
  });
});

describe('exact focus via the captured terminal identity', () => {
  const KITTY_TERM = { KITTY_WINDOW_ID: '3', KITTY_LISTEN_ON: 'unix:/tmp/kitty-sock' };
  const KITTY_WINDOWS = [
    { id: '0x7', wmClass: 'kitty', title: 'fix-exames — claude' },
    ...DEFAULT_WINDOWS,
  ];

  it('selects the kitty tab through its CLI and just raises the window', async () => {
    const { execFn, calls } = fakeExec({ windows: KITTY_WINDOWS });
    const result = await focusChatTab('chat-inexistente-xyz', {
      execFn,
      delayMs: 0,
      term: KITTY_TERM,
    });
    expect(result).toEqual({
      focused: true,
      tabFound: true,
      matchedTitle: 'fix-exames — claude',
      cause: null,
    });
    expect(calls[0]).toEqual({
      command: 'kitty',
      args: ['@', '--to', 'unix:/tmp/kitty-sock', 'focus-window', '--match', 'id:3'],
    });
    expect(calls).toEqual(
      expect.arrayContaining([{ command: 'xdotool', args: ['windowactivate', '0x7'] }]),
    );
    expect(keyPressesOf(calls)).toHaveLength(0);
  });

  it('outranks the configured terminal — the capture proves where the session lives', async () => {
    const { execFn, calls } = fakeExec({ windows: KITTY_WINDOWS });
    const result = await focusChatTab('chat-inexistente-xyz', {
      execFn,
      delayMs: 0,
      terminal: 'warp',
      term: KITTY_TERM,
    });
    expect(result.tabFound).toBe(true);
    expect(calls).toEqual(
      expect.arrayContaining([{ command: 'xdotool', args: ['windowactivate', '0x7'] }]),
    );
  });

  it('still hunts the host window by title after selecting a tmux pane', async () => {
    const { execFn, calls } = fakeExec();
    const result = await focusChatTab('projeto-alpha', {
      execFn,
      delayMs: 0,
      term: { TMUX: '/tmp/tmux-1000/default,1234,0', TMUX_PANE: '%5' },
    });
    // the pane got selected inside tmux...
    expect(calls.filter((call) => call.command === 'tmux').map((call) => call.args[2])).toEqual([
      'select-window',
      'select-pane',
      'switch-client',
    ]);
    // ...and the OS window still comes from the normal title hunt
    expect(result.tabFound).toBe(true);
    expect(result.matchedTitle).toBe('projeto-alpha — claude');
  });

  it('falls back to the title hunt when the exact CLI fails', async () => {
    const { execFn } = fakeExec({ failOn: ['kitty'] });
    const result = await focusChatTab('projeto-alpha', {
      execFn,
      delayMs: 0,
      term: KITTY_TERM,
    });
    expect(result.tabFound).toBe(true);
    expect(result.matchedTitle).toBe('projeto-alpha — claude');
  });
});

// On Wayland the compositor gates XTEST behind the RemoteDesktop portal, so
// pressing keys both prompts the user for remote access AND silently fails.
// The app passes allowInputInjection:false there: window activation still works
// (it is not XTEST), everything that types does not.
describe('with input injection refused', () => {
  it('focuses the window but never cycles tabs', async () => {
    const { execFn, calls } = fakeExec({
      windows: [{ id: '0x9', wmClass: 'dev.warp.Warp', title: 'aba-aleatoria' }],
      tabTitles: ['aba-aleatoria', 'outra-aba', 'fix-exames — claude'],
    });
    const result = await focusChatTab('fix-exames', {
      execFn,
      delayMs: 0,
      allowInputInjection: false,
    });
    expect(keyPressesOf(calls)).toHaveLength(0);
    expect(calls).toEqual(
      expect.arrayContaining([{ command: 'xdotool', args: ['windowactivate', '0x9'] }]),
    );
    expect(result.focused).toBe(true);
    expect(result.tabFound).toBe(false);
  });

  it('copies the reply instead of typing it', async () => {
    const { execFn, calls } = fakeExec();
    let copied = null;
    const mode = await sendReplyToWarp('projeto-alpha', 'pode seguir', {
      execFn,
      writeClipboard: (text) => {
        copied = text;
      },
      delayMs: 0,
      allowInputInjection: false,
    });
    expect(mode).toBe('clipboard');
    expect(copied).toBe('pode seguir');
    expect(calls.some((call) => call.args[0] === 'type')).toBe(false);
  });

  it('refuses to answer a question and says so', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('projeto-alpha', 2, {
      execFn,
      delayMs: 0,
      allowInputInjection: false,
    });
    expect(result).toBe('needs-terminal');
    expect(keyPressesOf(calls)).toHaveLength(0);
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
    expect(titleMatchesKeys('✳ Corrigir erro de layout', ['corrige o bug do tooltip'])).toBe(false);
  });
});

describe('answerQuestionInWarp', () => {
  it('presses Down x index then Return when the tab was found', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('projeto-alpha', 2, { execFn, delayMs: 0 });
    expect(result).toBe('answered');
    expect(keyPressesOf(calls).map((call) => call.args[2])).toEqual(['Down', 'Down', 'Return']);
  });

  it('answers the first option with Return only', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('projeto-alpha', 0, { execFn, delayMs: 0 });
    expect(result).toBe('answered');
    expect(keyPressesOf(calls).map((call) => call.args[2])).toEqual(['Return']);
  });

  it('refuses to press keys when the tab was not found', async () => {
    const { execFn, calls } = fakeExec();
    const result = await answerQuestionInWarp('chat-inexistente-xyz', 1, { execFn, delayMs: 0 });
    expect(result).toBe('not-found');
    // It may cycle tabs while hunting, but must never answer.
    const answerPresses = keyPressesOf(calls).filter((call) =>
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
    const typeCall = calls.find((call) => call.args[0] === 'type');
    expect(typeCall.args).toContain('pode seguir');
    expect(calls.at(-1).args).toEqual(['key', 'Return']);
  });

  it('falls back to the clipboard when typing fails', async () => {
    const { execFn } = fakeExec({ failOnAction: ['type'] });
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

  it('copies to clipboard when no terminal window exists at all', async () => {
    const { execFn } = fakeExec({ failOn: ['xdotool'] });
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
    const { execFn } = fakeExec({ failOn: ['xdotool'] });
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
