import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import * as nativeDefault from './win32-native.js';
import { MAX_JUMP_TABS } from './win32-native.js';
import { titleMatchesKeys } from './warp.js';
import { selectExactTab, readWaveTabIndex, VIA_APP_HINTS } from './terminal-target.js';

const execFileAsync = promisify(execFile);
const REPLY_TYPE_DELAY_MS = 350;

// "Go to tab N" shortcuts, by terminal executable. With one of these the app
// walks the tabs once, learns each index, and from then on jumps straight to
// the chat's tab — no Ctrl+Tab parade. {n} is the 1-based index.
const TAB_JUMP_KEYS = {
  warp: '^{n}',
  windowsterminal: '^%{n}', // Windows Terminal binds Ctrl+Alt+N
};

function jumpKeyFor(window) {
  const exe = window?.class?.toLowerCase() ?? '';
  const hint = Object.keys(TAB_JUMP_KEYS).find((key) => exe.includes(key));
  return hint ? TAB_JUMP_KEYS[hint] : null;
}

const jumpKeys = (template, index) => String(template).replace('{n}', String(index));

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

// Keys are injected into whatever window is in FRONT, not into a window of our
// choosing: if Windows refused to raise the terminal (foreground lock), typing
// anyway lands the keystrokes in whatever the user was using — a browser
// cycling its own tabs. So every injection site asks first.
async function holdsForeground(native, windowId, execFn) {
  if (typeof native.getForegroundWindow !== 'function') return true;
  const front = await native.getForegroundWindow({ execFn });
  if (front == null) return false;
  // The warp url and wsh focus a tab without ever enumerating windows, so
  // there is no id to compare against. Refusing there would make the exact
  // routes the only ones unable to answer — instead, confirm the window in
  // front belongs to a terminal, which is the property that matters.
  if (windowId == null) return foregroundIsTerminal(native, front, execFn);
  return String(front) === String(windowId);
}

async function foregroundIsTerminal(native, front, execFn) {
  if (typeof native.listWindows !== 'function') return false;
  const windows = await native.listWindows({ execFn });
  const ahead = windows.find((window) => String(window.id) === String(front));
  return Boolean(ahead && isTerminalWindow(ahead));
}

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
    term,
    sessionPid,
    tabIndex,
    openUrl,
  } = {},
) {
  try {
    const spec = TERMINALS[terminal] ?? TERMINALS.auto;
    // Selected once, here, and reused below: re-running it would fire the
    // terminal CLIs (and the url) a second time. Only the warp url both
    // selects the tab AND raises the window, so only it can return early —
    // a CLI that merely selected a pane still needs its window brought up.
    const exact = await selectExactTab(term, { execFn, openUrl });
    if (exact.selected && exact.via === 'warp') {
      return { focused: true, tabFound: true, matchedTitle: null, cause: null, via: 'warp' };
    }
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
        // wsh focusblock only reaches blocks in the ACTIVE tab, so the block's
        // tab has to become active first: Ctrl+<n> is Wave's own "switch to
        // tab" binding, and the index comes from Wave's DB — no cycling.
        const tab = await readWaveTabIndex(wave.tabId, { execFn });
        if (tab && !tab.active && tab.index < 9 && allowInputInjection) {
          await sleep(delayMs);
          await native.sendKeys(`^${tab.index + 1}`, { execFn });
          await sleep(delayMs);
        }
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

    // Exact route: the terminal's own CLI (WezTerm here) already selected the
    // session's pane above, from the identity the hook captured; Win32 only
    // has to raise its window. The capture outranks the configured terminal —
    // it proves where the session actually lives.
    const exactExeHint = exact.selected ? VIA_APP_HINTS[exact.via]?.exeHint : null;
    if (exactExeHint) {
      const exactWindow = windows.find((window) =>
        window.class.toLowerCase().includes(exactExeHint),
      );
      if (exactWindow) {
        await native.activateWindow(exactWindow.id, { execFn });
        return {
          focused: true,
          tabFound: true,
          matchedTitle: exactWindow.title,
          cause: null,
          windowId: exactWindow.id,
        };
      }
    }

    // The session's claude pid climbs the process tree up to the terminal
    // process that owns a window — proof of WHERE the session lives. With
    // several terminal windows around, a title match in another window must
    // lose to the proven owner, so the hunt narrows to it.
    let scope = windows;
    let scoped = false;
    if (sessionPid && typeof native.listProcessAncestors === 'function') {
      const ancestors = await native.listProcessAncestors(sessionPid, { execFn });
      // Every window of the owning process, not just the first: Warp hosts all
      // its windows under one pid, and keeping only one would throw away the
      // sibling whose tab actually holds the chat.
      const owned = windows.filter((window) => ancestors.includes(Number(window.pid)));
      if (owned.length) {
        scope = owned;
        scoped = true;
      }
    }

    // The owner window outranks the configured terminal preference: the pid
    // proves the session lives there, whatever the user picked in settings.
    const preferredHint = spec.exeHint;
    const isPreferred = (window) =>
      scoped || preferredHint === null
        ? true
        : window.class.toLowerCase().includes(preferredHint);

    const directMatches = scope.filter((window) => matches(window.title));
    const direct = directMatches.find(isPreferred) ?? directMatches[0];
    if (direct) {
      await native.activateWindow(direct.id, { execFn });
      return {
        focused: true,
        tabFound: true,
        matchedTitle: direct.title,
        cause: null,
        windowId: direct.id,
        tabIndex,
        via: 'active-tab', // already the tab in front: nothing to press
      };
    }

    let sawEveryTab = false;
    if (allowInputInjection && spec.hasTabs && spec.nextTabKey) {
      let refused = false;
      for (const candidate of scope.filter(isPreferred)) {
        await native.activateWindow(candidate.id, { execFn });
        await sleep(delayMs);
        if (!(await holdsForeground(native, candidate.id, execFn))) {
          refused = true;
          continue; // never cycle tabs blind — the keys would hit another app
        }
        const initialTitle = await native.getWindowTitle(candidate.id, { execFn });
        if (matches(initialTitle)) {
          return {
            focused: true,
            tabFound: true,
            matchedTitle: initialTitle,
            cause: null,
            windowId: candidate.id,
            tabIndex,
          };
        }

        // Fast route: terminals with a "go to tab N" shortcut never need the
        // Ctrl+Tab parade. A remembered index is one keystroke; an unknown one
        // costs a single walk that maps every tab at once.
        const jumpKey = jumpKeyFor(candidate);
        if (jumpKey && typeof native.readTabTitles === 'function') {
          if (tabIndex && tabIndex <= MAX_JUMP_TABS) {
            await native.sendKeys(jumpKeys(jumpKey, tabIndex), { execFn });
            await sleep(delayMs);
            const jumped = await native.getWindowTitle(candidate.id, { execFn });
            if (matches(jumped)) {
              return {
                focused: true,
                tabFound: true,
                matchedTitle: jumped,
                cause: null,
                windowId: candidate.id,
                tabIndex,
                via: 'jump-cached',
              };
            }
            // the chat moved (tab closed or reordered) — fall through to a walk
          }
          const tabs = await native.readTabTitles(candidate.id, {
            execFn,
            maxTabs,
            jumpKey,
          });
          // Focus was stolen mid-walk: nothing was seen past that point, and
          // pressing on would type into whatever took over.
          if (tabs.aborted) {
            refused = true;
            continue;
          }
          if (tabs.length) {
            const hit = tabs.find((tab) => matches(tab.title));
            if (hit) {
              await native.sendKeys(jumpKeys(jumpKey, hit.index), { execFn });
              return {
                focused: true,
                tabFound: true,
                matchedTitle: hit.title,
                cause: null,
                windowId: candidate.id,
                tabIndex: hit.index,
                via: 'jump-walk',
              };
            }
            // The walk left the terminal on its last tab — put the user back
            // where they were instead of on a random chat.
            const origin = tabs.find((tab) => tab.title === initialTitle);
            if (origin) await native.sendKeys(jumpKeys(jumpKey, origin.index), { execFn });
            sawEveryTab = true;
            continue; // every tab was seen; cycling would only repeat the walk
          }
        }
        for (let press = 0; press < maxTabs; press++) {
          // focus can be stolen mid-cycle (a dialog, another app) — re-check
          // before every press instead of trusting the first answer
          if (!(await holdsForeground(native, candidate.id, execFn))) {
            refused = true;
            break;
          }
          await native.sendKeys(spec.nextTabKey, { execFn });
          await sleep(delayMs);
          const title = await native.getWindowTitle(candidate.id, { execFn });
          if (matches(title)) {
            return {
              focused: true,
              tabFound: true,
              matchedTitle: title,
              cause: null,
              windowId: candidate.id,
              via: 'cycle',
            };
          }
          if (title === initialTitle) {
            sawEveryTab = true; // wrapped all the way around
            break;
          }
        }
      }
      // The window is up but Windows kept focus elsewhere, so the tab hunt
      // never ran — say so instead of blaming the terminal's tab titles.
      if (refused) {
        return { focused: true, tabFound: false, matchedTitle: null, cause: 'focus-refused' };
      }
    }

    const anyPreferred = scope.find(isPreferred);
    if (anyPreferred) {
      await native.activateWindow(anyPreferred.id, { execFn });
      return {
        focused: true,
        tabFound: false,
        matchedTitle: null,
        // only a hunt that actually inspected every tab can blame the titles
        cause: sawEveryTab ? 'no-tab-matched' : null,
        windowId: anyPreferred.id,
      };
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
    term,
    sessionPid,
    tabIndex,
    openUrl,
  } = {},
) {
  const { focused, tabFound, windowId } = await focusChatTab(searchKeys, {
    native,
    execFn,
    delayMs,
    terminal,
    allowInputInjection,
    wave,
    term,
    sessionPid,
    tabIndex,
    openUrl,
  });
  // The terminal is focused either way, so the user can answer by hand.
  if (!allowInputInjection) return 'needs-terminal';
  if (!focused || !tabFound) return 'not-found';
  try {
    await sleep(delayMs);
    // Arrow keys and Enter go wherever the focus is: refuse to press them
    // unless the chat's own window is the one in front.
    if (!(await holdsForeground(native, windowId, execFn))) return 'not-found';
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
    term,
    sessionPid,
    tabIndex,
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

  const { focused, tabFound, windowId } = await focusChatTab(searchKeys, {
    native,
    execFn,
    delayMs,
    terminal,
    allowInputInjection,
    wave,
    term,
    sessionPid,
    tabIndex,
    openUrl,
  });
  if (!focused || !tabFound) return clipboardFallback();
  if (!allowInputInjection) return clipboardFallback();

  try {
    // Give the window manager a beat to actually move focus before typing.
    await sleep(delayMs);
    // Typing into whatever happens to be in front would scatter the reply
    // across another app — the clipboard is the safe landing instead.
    if (!(await holdsForeground(native, windowId, execFn))) return clipboardFallback();
    await native.typeText(text, { execFn });
    await native.sendKeys('{ENTER}', { execFn });
    return 'typed';
  } catch {
    return clipboardFallback();
  }
}
