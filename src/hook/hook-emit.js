#!/usr/bin/env node
// Standalone on purpose: Claude Code runs this on every hook event, so it
// must start fast, never block, and ALWAYS exit 0.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// The legacy env name stays accepted: a `claude -p` spawned by an old
// claude-manager build still running would otherwise loop through this hook.
if (process.env.VIZOR_INTERNAL === '1' || process.env.CLAUDE_MANAGER_INTERNAL === '1')
  process.exit(0);

const socketPath =
  process.env.VIZOR_SOCKET ??
  (process.platform === 'win32'
    ? // must mirror managerSocketPath() in src/main/paths.js (standalone file,
      // no imports allowed)
      `\\\\.\\pipe\\vizor-${os.userInfo().username.replace(/[^A-Za-z0-9_-]/g, '-')}`
    : path.join(os.homedir(), '.config', 'vizor', 'vizor.sock'));

// Hard safety net: whatever happens, get out of Claude Code's way.
setTimeout(() => process.exit(0), 3000);

function fallbackNotify(event) {
  const eventName = event?.hook_event_name;
  if (eventName !== 'Stop' && eventName !== 'Notification') return;
  if (process.platform === 'win32') return; // no fast CLI notifier — stay silent
  const projectName = event?.cwd ? path.basename(event.cwd) : 'uma sessão';
  const body =
    eventName === 'Stop'
      ? `A tarefa do '${projectName}' terminou.`
      : (event?.message ?? `O '${projectName}' está esperando você.`);
  try {
    const [command, args] =
      process.platform === 'darwin'
        ? ['osascript', ['-e', `display notification ${JSON.stringify(body)} with title "Vizor"`]]
        : ['notify-send', ['Vizor', body]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // missing binary must never break exit 0
    child.unref();
  } catch {
    // no notifier available, nothing else to do
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const { WAVETERM_BLOCKID, WAVETERM_TABID, WAVETERM_JWT } = process.env;
  if (WAVETERM_BLOCKID && WAVETERM_TABID && WAVETERM_JWT) {
    event.wave = { blockId: WAVETERM_BLOCKID, tabId: WAVETERM_TABID, jwt: WAVETERM_JWT };
  }
  // Each terminal stamps its tabs/panes with identifying env vars, and this
  // hook inherits the session's environment — the only place that identity is
  // visible. Raw values only; interpreting them is the app's job.
  const term = {};
  for (const key of [
    'ITERM_SESSION_ID',
    'TERM_SESSION_ID',
    'KITTY_WINDOW_ID',
    'KITTY_LISTEN_ON',
    'WEZTERM_PANE',
    'WEZTERM_UNIX_SOCKET',
    'TMUX',
    'TMUX_PANE',
    'WT_SESSION',
    // Warp hands every session a uuid that its own warp://session/<uuid> url
    // focuses — the whole tab hunt collapses into opening that link.
    'WARP_TERMINAL_SESSION_UUID',
  ]) {
    if (process.env[key]) term[key] = process.env[key];
  }
  if (Object.keys(term).length) event.term = term;
  const socket = net.connect(socketPath);
  socket.on('connect', () => socket.end(`${JSON.stringify(event)}\n`));
  socket.on('close', () => process.exit(0));
  socket.on('error', () => {
    fallbackNotify(event);
    process.exit(0);
  });
});
