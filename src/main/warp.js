import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { selectExactTab, VIA_APP_HINTS } from './terminal-target.js';

const execFileAsync = promisify(execFile);
const REPLY_TYPE_DELAY_MS = 350;

// Window listing without wmctrl: xdotool prints ids, then class and title come
// one query at a time. --onlyvisible is deliberately NOT used — it reported 1
// window out of 22 on GNOME/XWayland, hiding the very terminal we look for.
export async function listWindows({ execFn = execFileAsync } = {}) {
  let ids;
  try {
    const { stdout } = await execFn('xdotool', ['search', '--class', '.']);
    ids = String(stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return []; // xdotool missing or no X display — the caller names the cause
  }

  const windows = [];
  for (const id of ids) {
    try {
      const [classResult, nameResult] = await Promise.all([
        execFn('xdotool', ['getwindowclassname', id]),
        execFn('xdotool', ['getwindowname', id]),
      ]);
      windows.push({
        id,
        wmClass: String(classResult.stdout ?? '').trim(),
        title: String(nameResult.stdout ?? '').trim(),
      });
    } catch {
      // Window closed between the search and the query — skip it.
    }
  }
  return windows;
}

// User-selectable terminal apps. classHint filters windows by WM_CLASS;
// nextTabKey is each app's default "next tab" keystroke (xdotool syntax);
// hasTabs=false skips tab hunting entirely.
export const TERMINALS = {
  auto: { label: 'Auto (detectar)', classHint: null, nextTabKey: 'ctrl+Tab', hasTabs: true },
  warp: { label: 'Warp', classHint: 'warp', nextTabKey: 'ctrl+Tab', hasTabs: true },
  'gnome-terminal': {
    label: 'GNOME Terminal',
    classHint: 'gnome-terminal',
    nextTabKey: 'ctrl+Next',
    hasTabs: true,
  },
  kgx: { label: 'GNOME Console', classHint: 'kgx', nextTabKey: 'ctrl+Next', hasTabs: true },
  ptyxis: {
    label: 'Ptyxis (padrão do Fedora)',
    classHint: 'ptyxis',
    nextTabKey: 'ctrl+Page_Down',
    hasTabs: true,
  },
  kitty: { label: 'Kitty', classHint: 'kitty', nextTabKey: 'ctrl+shift+bracketright', hasTabs: true },
  alacritty: { label: 'Alacritty', classHint: 'alacritty', nextTabKey: null, hasTabs: false },
  konsole: { label: 'Konsole', classHint: 'konsole', nextTabKey: 'shift+Right', hasTabs: true },
  blackbox: {
    label: 'Black Box',
    classHint: 'blackbox',
    nextTabKey: 'ctrl+Next',
    hasTabs: true,
  },
  terminator: {
    label: 'Terminator',
    classHint: 'terminator',
    nextTabKey: 'ctrl+Next',
    hasTabs: true,
  },
  guake: {
    label: 'Guake (drop-down)',
    classHint: 'guake',
    nextTabKey: 'ctrl+Next',
    hasTabs: true,
    // drop-down terminal: hidden until summoned, so bring it up before hunting
    summon: ['guake', '--show'],
  },
  tilix: { label: 'Tilix', classHint: 'tilix', nextTabKey: 'ctrl+Next', hasTabs: true },
  wezterm: { label: 'WezTerm', classHint: 'wezterm', nextTabKey: 'ctrl+Tab', hasTabs: true },
};

function terminalSpec(terminal) {
  return TERMINALS[terminal] ?? TERMINALS.auto;
}

// Only terminal windows are focus candidates — otherwise a browser tab or
// this very app whose title mentions the project would steal the click.
const TERMINAL_CLASS_HINTS = [
  'warp',
  'terminal',
  'konsole',
  'kitty',
  'alacritty',
  'tilix',
  'xterm',
  'kgx',
  'ptyxis',
  'terminator',
  'guake',
  'blackbox',
  'wezterm',
];

function isTerminalWindow(window) {
  const wmClass = window.wmClass.toLowerCase();
  return TERMINAL_CLASS_HINTS.some((hint) => wmClass.includes(hint));
}

// Preference order: Warp window whose title mentions the chat > any terminal
// whose title mentions the chat (fallback) > any Warp.
export function pickTargetWindow(windows, projectName) {
  const terminals = windows.filter(isTerminalWindow);
  const isWarp = (window) => window.wmClass.toLowerCase().includes('warp');
  const nameLower = (projectName ?? '').toLowerCase();
  const titleMatches = nameLower
    ? terminals.filter((window) => window.title.toLowerCase().includes(nameLower))
    : [];
  return titleMatches.find(isWarp) ?? titleMatches[0] ?? terminals.find(isWarp) ?? null;
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// Accent-insensitive match: full substring OR at least two ≥4-char words of
// the key appearing in the title (one word is enough for one-word keys).
export function titleMatchesKeys(title, keys) {
  const titleNorm = normalize(title);
  for (const key of keys) {
    const keyNorm = normalize(key).trim();
    if (!keyNorm) continue;
    if (titleNorm.includes(keyNorm)) return true;
    const words = keyNorm.split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
    if (!words.length) continue;
    const hits = words.filter((word) => titleNorm.includes(word)).length;
    if (hits >= Math.min(2, words.length)) return true;
  }
  return false;
}

// X11 can't see Warp tabs — but the window TITLE follows the active tab. So
// to reach a chat hidden in a background tab: focus the Warp window and hit
// "next tab" (Ctrl+Tab, Warp's default) reading the title after each press,
// until it matches the chat, wraps around, or hits the safety cap.
export async function focusChatTab(
  searchKeys,
  {
    execFn = execFileAsync,
    delayMs = 200,
    maxTabs = 12,
    terminal = 'auto',
    allowInputInjection = true,
    term,
    openUrl,
  } = {},
) {
  try {
    const spec = terminalSpec(terminal);
    if (spec.summon) {
      // drop-down terminals (guake) stay hidden until summoned
      try {
        await execFn(spec.summon[0], spec.summon.slice(1));
        await sleep(delayMs);
      } catch {
        // not running or not installed — the normal hunt still applies
      }
    }
    // Exact route first: the terminal's own CLI selects the session's tab from
    // the identity the hook captured; xdotool then only has to raise its
    // window. The capture outranks the configured terminal — it proves where
    // the session actually lives. tmux selects too, but its host window is
    // unknown, so the title hunt below still decides which window to raise.
    const exact = await selectExactTab(term, { execFn, openUrl });
    const exactClassHint = exact.selected ? VIA_APP_HINTS[exact.via]?.classHint : null;
    const allWindows = await listWindows({ execFn });
    if (exactClassHint) {
      const exactWindow = allWindows.find((window) =>
        window.wmClass.toLowerCase().includes(exactClassHint),
      );
      if (exactWindow) {
        await execFn('xdotool', ['windowactivate', exactWindow.id]);
        return { focused: true, tabFound: true, matchedTitle: exactWindow.title, cause: null };
      }
    }
    if (!allWindows.length) {
      return { focused: false, tabFound: false, matchedTitle: null, cause: 'no-x-windows' };
    }
    const windows = allWindows.filter(isTerminalWindow);
    if (!windows.length) {
      return { focused: false, tabFound: false, matchedTitle: null, cause: 'terminal-not-in-x' };
    }
    // Windows of the chosen terminal (Warp when on auto) get priority and
    // are the only ones whose tabs we cycle through.
    const preferredHint = spec.classHint ?? 'warp';
    const isPreferred = (window) => window.wmClass.toLowerCase().includes(preferredHint);
    const keys = (Array.isArray(searchKeys) ? searchKeys : [searchKeys]).filter(
      (key) => typeof key === 'string' && key.trim(),
    );
    const matches = (title) => titleMatchesKeys(title, keys);

    const directMatches = windows.filter((window) => matches(window.title));
    const direct = directMatches.find(isPreferred) ?? directMatches[0];
    if (direct) {
      await execFn('xdotool', ['windowactivate', direct.id]);
      return { focused: true, tabFound: true, matchedTitle: direct.title, cause: null };
    }

    const getTitle = async (id) => {
      const result = await execFn('xdotool', ['getwindowname', id]);
      return String(result.stdout ?? '').trim();
    };

    // Cycling tabs means pressing keys, which is XTEST. On Wayland that both
    // prompts the user for remote access and silently fails, so it is skipped
    // and the caller settles for focusing the right window.
    if (allowInputInjection && spec.hasTabs && spec.nextTabKey) {
      for (const candidate of windows.filter(isPreferred)) {
        await execFn('xdotool', ['windowactivate', candidate.id]);
        await sleep(delayMs);
        const initialTitle = await getTitle(candidate.id);
        if (matches(initialTitle)) {
          return { focused: true, tabFound: true, matchedTitle: initialTitle, cause: null };
        }
        for (let press = 0; press < maxTabs; press++) {
          await execFn('xdotool', ['key', '--clearmodifiers', spec.nextTabKey]);
          await sleep(delayMs);
          const title = await getTitle(candidate.id);
          if (matches(title)) {
            return { focused: true, tabFound: true, matchedTitle: title, cause: null };
          }
          if (title === initialTitle) break; // wrapped all the way around
        }
      }
    }

    const anyPreferred = windows.find(isPreferred);
    if (anyPreferred) {
      await execFn('xdotool', ['windowactivate', anyPreferred.id]);
      return { focused: true, tabFound: false, matchedTitle: null, cause: null };
    }
    return { focused: false, tabFound: false, matchedTitle: null, cause: 'terminal-not-in-x' };
  } catch {
    return { focused: false, tabFound: false, matchedTitle: null, cause: 'xdotool-failed' };
  }
}

// Answers a single-select question in the terminal by selecting the option
// with arrow keys: Down × optionIndex, then Return. Only ever presses keys
// when the chat's tab was positively found — never into an unknown tab.
export async function answerQuestionInWarp(
  searchKeys,
  optionIndex,
  {
    execFn = execFileAsync,
    delayMs = REPLY_TYPE_DELAY_MS,
    terminal = 'auto',
    allowInputInjection = true,
    term,
    openUrl,
  } = {},
) {
  const { focused, tabFound } = await focusChatTab(searchKeys, {
    execFn,
    delayMs,
    terminal,
    allowInputInjection,
    term,
    openUrl,
  });
  // The terminal is focused either way, so the user can answer by hand.
  if (!allowInputInjection) return 'needs-terminal';
  if (!focused || !tabFound) return 'not-found';
  try {
    await sleep(delayMs);
    for (let press = 0; press < optionIndex; press++) {
      await execFn('xdotool', ['key', '--clearmodifiers', 'Down']);
      await sleep(delayMs / 4);
    }
    await execFn('xdotool', ['key', '--clearmodifiers', 'Return']);
    return 'answered';
  } catch {
    return 'failed';
  }
}

export async function focusWarpWindow(projectName, execFn = execFileAsync) {
  const result = await focusChatTab(projectName, { execFn, delayMs: 0 });
  return result.focused;
}

// Types the reply into the (freshly focused) Warp window via xdotool; falls
// back to putting the text on the clipboard so the user can paste it.
// Returns 'typed' | 'clipboard' | 'failed'.
export async function sendReplyToWarp(
  searchKeys,
  text,
  {
    execFn = execFileAsync,
    writeClipboard,
    delayMs = REPLY_TYPE_DELAY_MS,
    terminal = 'auto',
    allowInputInjection = true,
    term,
    openUrl,
  } = {},
) {
  const clipboardFallback = () => {
    try {
      writeClipboard(text);
      return 'clipboard';
    } catch {
      return 'failed';
    }
  };

  const { focused } = await focusChatTab(searchKeys, {
    execFn,
    delayMs,
    terminal,
    allowInputInjection,
    term,
    openUrl,
  });
  if (!focused) return clipboardFallback();
  // Typing is XTEST: refused on Wayland, so the reply goes to the clipboard
  // with the terminal already focused and waiting for a paste.
  if (!allowInputInjection) return clipboardFallback();

  try {
    // Give the window manager a beat to actually move focus before typing.
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await execFn('xdotool', ['type', '--clearmodifiers', '--delay', '25', '--', text]);
    await execFn('xdotool', ['key', 'Return']);
    return 'typed';
  } catch {
    return clipboardFallback();
  }
}
