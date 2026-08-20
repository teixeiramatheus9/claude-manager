import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// Terminals with a real control CLI can select the exact tab/pane of a
// session, cross-platform, using the identity the hook captured from its env.
// Selecting the tab and raising the OS window are different jobs: this module
// only does the first — the platform module raises the window with its own
// idiom (osascript / xdotool / SetForegroundWindow) afterwards.

// tmux is deliberately reported without an app hint: the pane lives inside
// whatever host terminal the user attached from, which the env cannot name.
export const VIA_APP_HINTS = {
  kitty: { darwinApp: 'kitty', classHint: 'kitty', exeHint: null },
  wezterm: { darwinApp: 'WezTerm', classHint: 'wezterm', exeHint: 'wezterm' },
  tmux: { darwinApp: null, classHint: null, exeHint: null },
};

// Selects the session's tab/pane through its terminal's own CLI. Returns
// { selected, via } — { selected: false, via: null } when the capture names no
// controllable terminal or its CLI is unavailable/refused.
export async function selectExactTab(term, { execFn = execFileAsync } = {}) {
  if (!term || typeof term !== 'object') return { selected: false, via: null };

  if (term.KITTY_WINDOW_ID && term.KITTY_LISTEN_ON) {
    try {
      await execFn('kitty', [
        '@',
        '--to',
        term.KITTY_LISTEN_ON,
        'focus-window',
        '--match',
        `id:${term.KITTY_WINDOW_ID}`,
      ]);
      return { selected: true, via: 'kitty' };
    } catch {
      // remote control off or the window is gone — fall through
    }
  }

  if (term.WEZTERM_PANE) {
    try {
      await execFn('wezterm', ['cli', 'activate-pane', '--pane-id', term.WEZTERM_PANE], {
        env: term.WEZTERM_UNIX_SOCKET
          ? { ...process.env, WEZTERM_UNIX_SOCKET: term.WEZTERM_UNIX_SOCKET }
          : process.env,
      });
      return { selected: true, via: 'wezterm' };
    } catch {
      // wezterm not on PATH or the pane is gone — fall through
    }
  }

  if (term.TMUX && term.TMUX_PANE) {
    // TMUX is "<socket>,<server pid>,<session idx>"; the socket pins the right
    // server. select-window + select-pane make the pane current in its session;
    // switch-client re-points an attached client that sits on another session,
    // and is best-effort because there may be no client at all.
    const socket = String(term.TMUX).split(',')[0];
    if (socket) {
      try {
        await execFn('tmux', ['-S', socket, 'select-window', '-t', term.TMUX_PANE]);
        await execFn('tmux', ['-S', socket, 'select-pane', '-t', term.TMUX_PANE]);
        try {
          await execFn('tmux', ['-S', socket, 'switch-client', '-t', term.TMUX_PANE]);
        } catch {
          // already on the session, or detached
        }
        return { selected: true, via: 'tmux' };
      } catch {
        // server gone or pane closed — fall through
      }
    }
  }

  return { selected: false, via: null };
}

// wsh focusblock only reaches blocks in the ACTIVE tab, and no wsh command
// switches tabs (v0.14) — so the block's tab has to become active first. The
// tab order lives in Wave's own DB; with the index in hand, the platform
// module sends Wave's native "switch to tab <n>" shortcut, no cycling.
export function waveDbPath({ platform = process.platform, env = process.env, home } = {}) {
  const homeDir = home ?? os.homedir();
  const dataDir =
    platform === 'darwin'
      ? path.join(homeDir, 'Library', 'Application Support', 'waveterm')
      : platform === 'win32'
        ? env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'waveterm')
        : path.join(env.XDG_DATA_HOME ?? path.join(homeDir, '.local', 'share'), 'waveterm');
  return dataDir ? path.join(dataDir, 'db', 'waveterm.db') : null;
}

export function waveTabIndex(workspaceRows, tabId) {
  for (const line of String(workspaceRows ?? '').split('\n')) {
    let workspace;
    try {
      workspace = JSON.parse(line);
    } catch {
      continue;
    }
    const pinned = Array.isArray(workspace?.pinnedtabids) ? workspace.pinnedtabids : [];
    const plain = Array.isArray(workspace?.tabids) ? workspace.tabids : [];
    // the tab bar shows pinned tabs first, and the shortcut follows that order
    const order = [...pinned, ...plain.filter((id) => !pinned.includes(id))];
    const index = order.indexOf(tabId);
    if (index >= 0) return { index, active: workspace.activetabid === tabId };
  }
  return null;
}

// The sqlite3 CLI ships with macOS and most Linuxes; Windows usually has
// neither, so node's own sqlite steps in there. Both read-only.
export async function readWaveTabIndex(tabId, { execFn = execFileAsync, ...pathOpts } = {}) {
  const dbPath = waveDbPath(pathOpts);
  if (!dbPath || !tabId) return null;
  try {
    const { stdout } = await execFn('sqlite3', [
      `file:${dbPath}?mode=ro`,
      'select data from db_workspace',
    ]);
    return waveTabIndex(stdout, tabId);
  } catch {
    // fall through to node:sqlite
  }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare('select data from db_workspace').all();
      return waveTabIndex(rows.map((row) => row.data).join('\n'), tabId);
    } finally {
      db.close();
    }
  } catch {
    return null; // no sqlite anywhere — focusblock still gets its shot
  }
}
