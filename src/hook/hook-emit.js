#!/usr/bin/env node
// Standalone on purpose: Claude Code runs this on every hook event, so it
// must start fast, never block, and ALWAYS exit 0.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

if (process.env.CLAUDE_MANAGER_INTERNAL === '1') process.exit(0);

const socketPath =
  process.env.CLAUDE_MANAGER_SOCKET ??
  path.join(os.homedir(), '.config', 'claude-manager', 'manager.sock');

// Hard safety net: whatever happens, get out of Claude Code's way.
setTimeout(() => process.exit(0), 3000);

function fallbackNotify(event) {
  const eventName = event?.hook_event_name;
  if (eventName !== 'Stop' && eventName !== 'Notification') return;
  const projectName = event?.cwd ? path.basename(event.cwd) : 'uma sessão';
  const body =
    eventName === 'Stop'
      ? `A tarefa do '${projectName}' terminou.`
      : (event?.message ?? `O '${projectName}' está esperando você.`);
  try {
    spawn('notify-send', ['Claude Manager', body], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // no notify-send, nothing else to do
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
  const socket = net.connect(socketPath);
  socket.on('connect', () => socket.end(`${JSON.stringify(event)}\n`));
  socket.on('close', () => process.exit(0));
  socket.on('error', () => {
    fallbackNotify(event);
    process.exit(0);
  });
});
