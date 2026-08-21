import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listWindows as xdotoolListWindows } from './warp.js';

const execFileAsync = promisify(execFile);

const BRIDGE_CALL = [
  'call',
  '--session',
  '--dest',
  'org.gnome.Shell',
  '--object-path',
  '/org/gnome/Shell/Extensions/VizorBridge',
  '--method',
];

const fromB64 = (b64) => Buffer.from(b64, 'base64').toString('utf8');
const toB64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function callBridge(execFn, method, args = []) {
  const { stdout } = await execFn('gdbus', [...BRIDGE_CALL, `app.vizor.Bridge.${method}`, ...args]);
  // Every string the bridge returns is base64/semver, so this simple quote
  // scan never meets an escaped quote.
  const match = String(stdout ?? '').match(/\('([^']*)'/);
  return match ? match[1] : '';
}

// The same five verbs xdotool gave the hunt on X11. Both backends promise
// identical semantics so focusChatTab stays display-server-blind.
export function xdotoolDriver({ execFn = execFileAsync } = {}) {
  return {
    listWindows: () => xdotoolListWindows({ execFn }),
    activate: async (id) => {
      await execFn('xdotool', ['windowactivate', id]);
    },
    getTitle: async (id) => {
      const { stdout } = await execFn('xdotool', ['getwindowname', id]);
      return String(stdout ?? '').trim();
    },
    pressKey: async (combo) => {
      await execFn('xdotool', ['key', '--clearmodifiers', combo]);
    },
    typeText: async (text) => {
      await execFn('xdotool', ['type', '--clearmodifiers', '--delay', '25', '--', text]);
    },
  };
}

export function bridgeDriver({ execFn = execFileAsync } = {}) {
  return {
    listWindows: async () => {
      const list = JSON.parse(fromB64(await callBridge(execFn, 'ListWindows')) || '[]');
      return list.map((window) => ({
        id: window.id,
        // Wayland-native windows may carry only an app id; folding it in
        // keeps the TERMINALS class hints matching either way.
        wmClass: window.wmClass || window.appId || '',
        title: window.title ?? '',
      }));
    },
    activate: async (id) => {
      await callBridge(execFn, 'Activate', [String(id)]);
    },
    getTitle: async (id) => fromB64(await callBridge(execFn, 'GetTitle', [String(id)])),
    pressKey: async (combo) => {
      await callBridge(execFn, 'PressKey', [combo]);
    },
    typeText: async (text) => {
      await callBridge(execFn, 'TypeText', [toB64(text)]);
    },
  };
}

export async function bridgeResponding({ execFn = execFileAsync } = {}) {
  try {
    return Boolean(await callBridge(execFn, 'Version'));
  } catch {
    return false;
  }
}

// X11 keeps xdotool (unchanged, battle-tested). Wayland upgrades to the
// bridge when it answers; when it does not, xdotool still runs so the
// failure causes (and their hints) stay exactly as they are today.
export async function resolveWindowDriver({ canInjectInput, execFn = execFileAsync } = {}) {
  if (!canInjectInput && (await bridgeResponding({ execFn }))) {
    return { driver: bridgeDriver({ execFn }), kind: 'bridge' };
  }
  return { driver: xdotoolDriver({ execFn }), kind: 'xdotool' };
}
