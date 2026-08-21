import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEST = ['--session', '--dest', 'org.gnome.Terminal'];

// GNOME Terminal exports one org.gtk.Actions object per window with an
// 'active-tab' action (int32 index) — a tab switch with no keystrokes, on
// X11 and Wayland alike. The ObjectManager does not list the window objects,
// so enumeration goes through plain introspection of the parent node.
export async function listTerminalWindows({ execFn = execFileAsync } = {}) {
  try {
    const { stdout } = await execFn('gdbus', [
      'introspect',
      ...DEST,
      '--object-path',
      '/org/gnome/Terminal/window',
    ]);
    return [...String(stdout ?? '').matchAll(/node (\d+)/g)].map(
      (match) => `/org/gnome/Terminal/window/${match[1]}`,
    );
  } catch {
    return []; // not running, or no gdbus — the key-press hunt still applies
  }
}

// 'active-tab' silently clamps out-of-range indexes, so the state readback is
// both the confirmation and the "wrapped around" signal of the hunt loop.
export async function selectTab({ execFn = execFileAsync } = {}, windowPath, index) {
  try {
    await execFn('gdbus', [
      'call',
      ...DEST,
      '--object-path',
      windowPath,
      '--method',
      'org.gtk.Actions.Activate',
      'active-tab',
      `[<${index}>]`,
      '{}',
    ]);
    const { stdout } = await execFn('gdbus', [
      'call',
      ...DEST,
      '--object-path',
      windowPath,
      '--method',
      'org.gtk.Actions.Describe',
      'active-tab',
    ]);
    const state = String(stdout ?? '').match(/\[<(\d+)>\]/);
    return Boolean(state) && Number(state[1]) === index;
  } catch {
    return false;
  }
}
