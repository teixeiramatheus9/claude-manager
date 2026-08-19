import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const REPLY_TYPE_DELAY_MS = 350;

export const TERMINALS = {
  auto: { label: 'Auto (detectar)', appName: null },
  waveterm: { label: 'WaveTerm', appName: 'Wave' },
  'terminal-app': { label: 'Terminal.app', appName: 'Terminal' },
  iterm2: { label: 'iTerm2', appName: 'iTerm' },
  warp: { label: 'Warp', appName: 'Warp' },
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

// Focus is exact on WaveTerm: the hook captured the block's wsh credentials,
// so the app activates Wave and asks wsh to focus that block. Other terminals
// only get activated (tabFound stays false, so nothing is ever typed blind).
export async function focusChatTab(
  searchKeys,
  { execFn = execFileAsync, terminal = 'auto', wave } = {},
) {
  const spec = TERMINALS[terminal] ?? TERMINALS.auto;
  const useWave = hasWaveTarget(wave) && (spec.appName === null || spec.appName === 'Wave');
  const appName = spec.appName ?? (useWave ? 'Wave' : null);
  if (!appName) return { focused: false, tabFound: false, matchedTitle: null };
  try {
    await execFn('osascript', ['-e', `tell application "${appName}" to activate`]);
  } catch {
    return { focused: false, tabFound: false, matchedTitle: null };
  }
  if (useWave) {
    try {
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
      // block gone or wsh unavailable — the app itself is focused
    }
  }
  return { focused: true, tabFound: false, matchedTitle: null };
}

export async function answerQuestionInWarp(
  searchKeys,
  optionIndex,
  { execFn = execFileAsync, delayMs = REPLY_TYPE_DELAY_MS, terminal = 'auto', wave } = {},
) {
  const { focused, tabFound } = await focusChatTab(searchKeys, { execFn, terminal, wave });
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
  { execFn = execFileAsync, writeClipboard, delayMs = REPLY_TYPE_DELAY_MS, terminal = 'auto', wave } = {},
) {
  const clipboardFallback = () => {
    try {
      writeClipboard(text);
      return 'clipboard';
    } catch {
      return 'failed';
    }
  };

  const { focused, tabFound } = await focusChatTab(searchKeys, { execFn, terminal, wave });
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
