import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectExactTab, readWaveTabIndex, VIA_APP_HINTS } from './terminal-target.js';
import { titleMatchesKeys } from './warp.js';

const execFileAsync = promisify(execFile);
const REPLY_TYPE_DELAY_MS = 350;

// Warp has no scripting API anywhere, but its macOS window title follows the
// active tab — so the X11 title hunt ports over: read the title through
// System Events (Accessibility), press "next tab", read again until it
// matches. processName + nextTabKeystroke mark the terminals hunted this way.
export const TERMINALS = {
  auto: { label: 'Auto (detectar)', appName: null },
  waveterm: { label: 'WaveTerm', appName: 'Wave' },
  'terminal-app': { label: 'Terminal.app', appName: 'Terminal' },
  iterm2: { label: 'iTerm2', appName: 'iTerm' },
  warp: {
    label: 'Warp',
    appName: 'Warp',
    processName: 'Warp',
    nextTabKeystroke: 'keystroke "]" using {command down, shift down}',
  },
  kitty: { label: 'Kitty', appName: 'kitty' },
  alacritty: { label: 'Alacritty', appName: 'Alacritty' },
  wezterm: { label: 'WezTerm', appName: 'WezTerm' },
};

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

const WSH_BUNDLED = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'waveterm',
  'bin',
  'wsh',
);

export function wshBinary(existsFn = fs.existsSync) {
  return existsFn(WSH_BUNDLED) ? WSH_BUNDLED : 'wsh';
}

function hasWaveTarget(wave) {
  return Boolean(wave?.blockId && wave?.tabId && wave?.jwt);
}

const keystroke = (execFn, script) =>
  execFn('osascript', ['-e', `tell application "System Events" to ${script}`]);

// The session's controlling tty is the one exact address Terminal.app and
// iTerm2 both expose per tab — no env capture needed, just the claude pid.
export async function resolveTty(pid, { execFn = execFileAsync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const { stdout } = await execFn('ps', ['-o', 'tty=', '-p', String(pid)]);
    const tty = String(stdout ?? '').trim();
    if (!tty || tty === '??' || tty === '-') return null;
    return tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
  } catch {
    return null;
  }
}

// tty values are interpolated into AppleScript, so they must look like a tty.
function assertTty(tty) {
  if (!/^\/dev\/[A-Za-z0-9._/-]+$/.test(String(tty))) throw new Error(`bad tty: ${tty}`);
  return String(tty);
}

// The "is running" guard keeps the tell block from LAUNCHING the app just to
// look for a tab that cannot be there.
export function terminalAppFocusScript(tty) {
  const target = assertTty(tty);
  return [
    'if application "Terminal" is running then',
    '  tell application "Terminal"',
    '    repeat with w in windows',
    '      repeat with t in tabs of w',
    `        if tty of t is "${target}" then`,
    '          set selected of t to true',
    '          set index of w to 1',
    '          activate',
    '          return "found"',
    '        end if',
    '      end repeat',
    '    end repeat',
    '  end tell',
    'end if',
    'return "missing"',
  ].join('\n');
}

export function itermFocusScript(tty) {
  const target = assertTty(tty);
  return [
    'if application "iTerm" is running then',
    '  tell application "iTerm"',
    '    repeat with w in windows',
    '      repeat with t in tabs of w',
    '        repeat with s in sessions of t',
    `          if tty of s is "${target}" then`,
    '            select s',
    '            select t',
    '            select w',
    '            activate',
    '            return "found"',
    '          end if',
    '        end repeat',
    '      end repeat',
    '    end repeat',
    '  end tell',
    'end if',
    'return "missing"',
  ].join('\n');
}

const TTY_SCRIPTS = {
  'terminal-app': [terminalAppFocusScript],
  iterm2: [itermFocusScript],
  auto: [terminalAppFocusScript, itermFocusScript],
};

const processExists = async (processName, execFn) => {
  const { stdout } = await execFn('osascript', [
    '-e',
    `tell application "System Events" to (exists process "${processName}")`,
  ]);
  return String(stdout ?? '').trim() === 'true';
};

const frontWindowTitle = async (processName, execFn) => {
  const { stdout } = await execFn('osascript', [
    '-e',
    `tell application "System Events" to get name of window 1 of process "${processName}"`,
  ]);
  return String(stdout ?? '').trim();
};

// The darwin twin of the X11 tab hunt: activate the app, read the front
// window's title (it follows the active tab), press "next tab" until it names
// the chat, wraps around, or hits the cap. Returns the matched title or null.
// The "exists process" probe comes first so an auto hunt never LAUNCHES an
// installed-but-closed terminal.
async function huntTabsByTitle(
  searchKeys,
  spec,
  { execFn, delayMs = 200, maxTabs = 12, allowInputInjection = true } = {},
) {
  const keys = (Array.isArray(searchKeys) ? searchKeys : [searchKeys]).filter(
    (key) => typeof key === 'string' && key.trim(),
  );
  if (!keys.length) return null;
  try {
    if (!(await processExists(spec.processName, execFn))) return null;
    await execFn('osascript', ['-e', `tell application "${spec.appName}" to activate`]);
    await sleep(delayMs);
    const initialTitle = await frontWindowTitle(spec.processName, execFn);
    if (titleMatchesKeys(initialTitle, keys)) return initialTitle;
    if (!allowInputInjection) return null;
    for (let press = 0; press < maxTabs; press++) {
      await keystroke(execFn, spec.nextTabKeystroke);
      await sleep(delayMs);
      const title = await frontWindowTitle(spec.processName, execFn);
      if (titleMatchesKeys(title, keys)) return title;
      if (title === initialTitle) break; // wrapped all the way around
    }
  } catch {
    // no Accessibility permission or the app vanished — the fallback stands
  }
  return null;
}

async function focusTabByTty(tty, { execFn, terminal }) {
  const builders = TTY_SCRIPTS[terminal] ?? [];
  for (const builder of builders) {
    try {
      const { stdout } = await execFn('osascript', ['-e', builder(tty)]);
      if (String(stdout ?? '').trim() === 'found') return true;
    } catch {
      // automation permission denied or the app misbehaved — try the next one
    }
  }
  return false;
}

// Exact focus, in order of precision: WaveTerm block via wsh, then a terminal
// CLI over the identity the hook captured (kitty, WezTerm, tmux), then the
// session's tty hunted through AppleScript (Terminal.app, iTerm2). Only when
// every exact route misses does it settle for activating the configured app —
// with tabFound false, so nothing is ever typed blind.
export async function focusChatTab(
  searchKeys,
  {
    execFn = execFileAsync,
    terminal = 'auto',
    wave,
    term,
    sessionPid,
    delayMs = 200,
    maxTabs = 12,
    allowInputInjection = true,
  } = {},
) {
  const spec = TERMINALS[terminal] ?? TERMINALS.auto;
  const useWave = hasWaveTarget(wave) && (spec.appName === null || spec.appName === 'Wave');
  if (useWave) {
    try {
      await execFn('osascript', ['-e', 'tell application "Wave" to activate']);
      // Cmd+<n> goes to the frontmost Wave window; with several windows the
      // wrong one may take it — the single-window case is the one that counts.
      const tab = await readWaveTabIndex(wave.tabId, { execFn });
      if (tab && !tab.active && tab.index < 9) {
        await sleep(250); // let the activation actually land before typing
        await keystroke(execFn, `keystroke "${tab.index + 1}" using command down`);
        await sleep(250);
      }
      await execFn(wshBinary(), ['focusblock', '-b', wave.blockId], {
        env: {
          ...process.env,
          WAVETERM_JWT: wave.jwt,
          WAVETERM_TABID: wave.tabId,
          WAVETERM_BLOCKID: wave.blockId,
        },
      });
      return { focused: true, tabFound: true, matchedTitle: null };
    } catch {
      // block gone or wsh unavailable — the exact routes below still apply
    }
  }

  // The capture outranks the configured terminal — it proves where the
  // session actually lives.
  const exact = await selectExactTab(term, { execFn });
  const exactApp = exact.selected ? VIA_APP_HINTS[exact.via]?.darwinApp : null;
  if (exactApp) {
    try {
      await execFn('osascript', ['-e', `tell application "${exactApp}" to activate`]);
      return { focused: true, tabFound: true, matchedTitle: null };
    } catch {
      // activation refused — the tab is selected anyway, keep going
    }
  }

  if (TTY_SCRIPTS[terminal]) {
    const tty = await resolveTty(sessionPid, { execFn });
    if (tty && (await focusTabByTty(tty, { execFn, terminal }))) {
      return { focused: true, tabFound: true, matchedTitle: null };
    }
  }

  // Terminals without any exact route (Warp) get the title hunt; on auto the
  // hunt tries Warp, mirroring the X11 fallback's preference — but only when
  // its process is already running.
  const huntSpec =
    spec.processName && spec.nextTabKeystroke ? spec : spec.appName === null ? TERMINALS.warp : null;
  if (huntSpec) {
    const matched = await huntTabsByTitle(searchKeys, huntSpec, {
      execFn,
      delayMs,
      maxTabs,
      allowInputInjection,
    });
    if (matched) return { focused: true, tabFound: true, matchedTitle: matched };
  }

  const appName = spec.appName ?? (useWave ? 'Wave' : null);
  if (!appName) return { focused: false, tabFound: false, matchedTitle: null };
  try {
    await execFn('osascript', ['-e', `tell application "${appName}" to activate`]);
  } catch {
    return { focused: false, tabFound: false, matchedTitle: null };
  }
  // A tmux pane selected by the CLI is inside an unknown host window, so the
  // activated app may or may not be it — never claim the tab was found.
  return { focused: true, tabFound: false, matchedTitle: null };
}

export async function answerQuestionInWarp(
  searchKeys,
  optionIndex,
  {
    execFn = execFileAsync,
    delayMs = REPLY_TYPE_DELAY_MS,
    terminal = 'auto',
    wave,
    term,
    sessionPid,
    allowInputInjection = true,
  } = {},
) {
  const { focused, tabFound } = await focusChatTab(searchKeys, {
    execFn,
    terminal,
    wave,
    term,
    sessionPid,
    allowInputInjection,
  });
  if (!focused || !tabFound) return 'not-found';
  try {
    await sleep(delayMs);
    for (let press = 0; press < optionIndex; press++) {
      await keystroke(execFn, 'key code 125');
      await sleep(delayMs / 4);
    }
    await keystroke(execFn, 'key code 36');
    return 'answered';
  } catch {
    return 'failed';
  }
}

export async function sendReplyToWarp(
  searchKeys,
  text,
  {
    execFn = execFileAsync,
    writeClipboard,
    delayMs = REPLY_TYPE_DELAY_MS,
    terminal = 'auto',
    wave,
    term,
    sessionPid,
    allowInputInjection = true,
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
    execFn,
    terminal,
    wave,
    term,
    sessionPid,
    allowInputInjection,
  });
  if (!focused || !tabFound) return clipboardFallback();
  try {
    await sleep(delayMs);
    await keystroke(execFn, `keystroke ${JSON.stringify(text)}`);
    await keystroke(execFn, 'key code 36');
    return 'typed';
  } catch {
    return clipboardFallback();
  }
}
