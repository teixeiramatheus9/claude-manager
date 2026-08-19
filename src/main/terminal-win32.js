import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import * as nativeDefault from './win32-native.js';
import { titleMatchesKeys } from './warp.js';

const execFileAsync = promisify(execFile);
const REPLY_TYPE_DELAY_MS = 350;

// User-selectable terminal apps on Windows. exeHint filters windows by their
// process executable name; nextTabKey is SendKeys syntax.
export const TERMINALS = {
  auto: { label: 'Auto (detectar)', exeHint: null, nextTabKey: '^{TAB}', hasTabs: true },
  'windows-terminal': {
    label: 'Windows Terminal',
    exeHint: 'windowsterminal',
    nextTabKey: '^{TAB}',
    hasTabs: true,
  },
  warp: { label: 'Warp', exeHint: 'warp', nextTabKey: '^{TAB}', hasTabs: true },
  waveterm: { label: 'WaveTerm', exeHint: 'wave', nextTabKey: null, hasTabs: false },
  alacritty: { label: 'Alacritty', exeHint: 'alacritty', nextTabKey: null, hasTabs: false },
  wezterm: { label: 'WezTerm', exeHint: 'wezterm', nextTabKey: '^{TAB}', hasTabs: true },
};

// Only terminal windows are focus candidates — otherwise a browser tab whose
// title mentions the project would steal the click. conhost covers classic
// cmd/powershell windows; mintty covers Git Bash.
const TERMINAL_EXE_HINTS = [
  'windowsterminal',
  'warp',
  'wave',
  'alacritty',
  'wezterm',
  'conhost',
  'cmd',
  'powershell',
  'pwsh',
  'mintty',
];

function isTerminalWindow(window) {
  const exe = window.class.toLowerCase();
  return TERMINAL_EXE_HINTS.some((hint) => exe.includes(hint));
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

const WSH_BUNDLED = path.join(process.env.LOCALAPPDATA ?? '', 'waveterm', 'bin', 'wsh.exe');

export function wshBinary(existsFn = fs.existsSync) {
  return existsFn(WSH_BUNDLED) ? WSH_BUNDLED : 'wsh';
}

function hasWaveTarget(wave) {
  return Boolean(wave?.blockId && wave?.tabId && wave?.jwt);
}

// Same contract as warp.js/terminal-darwin.js: find the window (and tab) that
// belongs to the chat, focus it, report whether the exact tab was found —
// keys are only ever injected into a positively identified tab.
export async function focusChatTab(
  searchKeys,
  {
    native = nativeDefault,
    execFn = execFileAsync,
    delayMs = 200,
    maxTabs = 12,
    terminal = 'auto',
    allowInputInjection = true,
    wave,
  } = {},
) {
  try {
    const spec = TERMINALS[terminal] ?? TERMINALS.auto;
    const useWave = hasWaveTarget(wave) && (spec.exeHint === null || spec.exeHint === 'wave');
    const allWindows = await native.listWindows();
    if (!allWindows.length) {
      return { focused: false, tabFound: false, matchedTitle: null, cause: 'no-windows' };
    }
    const windows = allWindows.filter(isTerminalWindow);
    if (!windows.length) {
      return { focused: false, tabFound: false, matchedTitle: null, cause: 'terminal-not-found' };
    }

    const keys = (Array.isArray(searchKeys) ? searchKeys : [searchKeys]).filter(
      (key) => typeof key === 'string' && key.trim(),
    );
    const matches = (title) => titleMatchesKeys(title, keys);

    // WaveTerm: the hook captured the block's wsh credentials, so focus is
    // exact — activate the Wave window and ask wsh for the block.
    if (useWave) {
      const waveWindow = windows.find((window) => window.class.toLowerCase().includes('wave'));
      if (waveWindow) {
        await native.activateWindow(waveWindow.id, { execFn });
        try {
          await execFn(wshBinary(), ['focusblock', '-b', wave.blockId], {
            env: {
              ...process.env,
              WAVETERM_JWT: wave.jwt,
              WAVETERM_TABID: wave.tabId,
              WAVETERM_BLOCKID: wave.blockId,
            },
          });
          return { focused: true, tabFound: true, matchedTitle: null, cause: null };
        } catch {
          // block gone or wsh unavailable — the window itself is focused
          return { focused: true, tabFound: false, matchedTitle: null, cause: null };
        }
      }
    }

    const preferredHint = spec.exeHint;
    const isPreferred = (window) =>
      preferredHint === null ? true : window.class.toLowerCase().includes(preferredHint);

    const directMatches = windows.filter((window) => matches(window.title));
    const direct = directMatches.find(isPreferred) ?? directMatches[0];
    if (direct) {
      await native.activateWindow(direct.id, { execFn });
      return { focused: true, tabFound: true, matchedTitle: direct.title, cause: null };
    }

    if (allowInputInjection && spec.hasTabs && spec.nextTabKey) {
      for (const candidate of windows.filter(isPreferred)) {
        await native.activateWindow(candidate.id, { execFn });
        await sleep(delayMs);
        const initialTitle = await native.getWindowTitle(candidate.id, { execFn });
        if (matches(initialTitle)) {
          return { focused: true, tabFound: true, matchedTitle: initialTitle, cause: null };
        }
        for (let press = 0; press < maxTabs; press++) {
          await native.sendKeys(spec.nextTabKey, { execFn });
          await sleep(delayMs);
          const title = await native.getWindowTitle(candidate.id, { execFn });
          if (matches(title)) {
            return { focused: true, tabFound: true, matchedTitle: title, cause: null };
          }
          if (title === initialTitle) break; // wrapped all the way around
        }
      }
    }

    const anyPreferred = windows.find(isPreferred);
    if (anyPreferred) {
      await native.activateWindow(anyPreferred.id, { execFn });
      return { focused: true, tabFound: false, matchedTitle: null, cause: null };
    }
    return { focused: false, tabFound: false, matchedTitle: null, cause: 'terminal-not-found' };
  } catch {
    return { focused: false, tabFound: false, matchedTitle: null, cause: 'powershell-failed' };
  }
}

export async function answerQuestionInWarp(
  searchKeys,
  optionIndex,
  {
    native = nativeDefault,
    execFn = execFileAsync,
    delayMs = REPLY_TYPE_DELAY_MS,
    terminal = 'auto',
    allowInputInjection = true,
    wave,
  } = {},
) {
  const { focused, tabFound } = await focusChatTab(searchKeys, {
    native,
    execFn,
    delayMs,
    terminal,
    allowInputInjection,
    wave,
  });
  // The terminal is focused either way, so the user can answer by hand.
  if (!allowInputInjection) return 'needs-terminal';
  if (!focused || !tabFound) return 'not-found';
  try {
    await sleep(delayMs);
    for (let press = 0; press < optionIndex; press++) {
      await native.sendKeys('{DOWN}', { execFn });
      await sleep(delayMs / 4);
    }
    await native.sendKeys('{ENTER}', { execFn });
    return 'answered';
  } catch {
    return 'failed';
  }
}

export async function sendReplyToWarp(
  searchKeys,
  text,
  {
    native = nativeDefault,
    execFn = execFileAsync,
    writeClipboard,
    delayMs = REPLY_TYPE_DELAY_MS,
    terminal = 'auto',
    allowInputInjection = true,
    wave,
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

  const { focused, tabFound } = await focusChatTab(searchKeys, {
    native,
    execFn,
    delayMs,
    terminal,
    allowInputInjection,
    wave,
  });
  if (!focused || !tabFound) return clipboardFallback();
  if (!allowInputInjection) return clipboardFallback();

  try {
    // Give the window manager a beat to actually move focus before typing.
    await sleep(delayMs);
    await native.typeText(text, { execFn });
    await native.sendKeys('{ENTER}', { execFn });
    return 'typed';
  } catch {
    return clipboardFallback();
  }
}
