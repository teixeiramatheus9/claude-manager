import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'hook',
  'hook-emit.js',
);

function runHook(input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookScript], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('close', (code) => resolve(code));
    child.stdin.end(input);
  });
}

describe('hook-emit', () => {
  it('forwards the event to the socket and exits 0', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-hook-'));
    const socketFile = path.join(dir, 'test.sock');
    const received = new Promise((resolve) => {
      const server = net.createServer((socket) => {
        let data = '';
        socket.on('data', (chunk) => {
          data += chunk;
        });
        socket.on('end', () => {
          server.close();
          resolve(data);
        });
      });
      server.listen(socketFile);
    });

    const event = { hook_event_name: 'Stop', session_id: 'abc', cwd: '/tmp/proj' };
    const exitCode = await runHook(JSON.stringify(event), { CLAUDE_MANAGER_SOCKET: socketFile });
    expect(exitCode).toBe(0);
    expect(JSON.parse(await received)).toEqual(event);
  });

  it('exits 0 immediately when CLAUDE_MANAGER_INTERNAL=1', async () => {
    const exitCode = await runHook('{"hook_event_name":"Stop"}', {
      CLAUDE_MANAGER_INTERNAL: '1',
      CLAUDE_MANAGER_SOCKET: '/nonexistent.sock',
    });
    expect(exitCode).toBe(0);
  });

  it('exits 0 when the socket does not exist', async () => {
    // UserPromptSubmit does not trigger the notify-send fallback, keeping tests silent
    const exitCode = await runHook(
      '{"hook_event_name":"UserPromptSubmit","session_id":"x","cwd":"/tmp"}',
      { CLAUDE_MANAGER_SOCKET: '/nonexistent/dir/absent.sock' },
    );
    expect(exitCode).toBe(0);
  });

  it('exits 0 on garbage stdin', async () => {
    const exitCode = await runHook('not json at all', {
      CLAUDE_MANAGER_SOCKET: '/nonexistent.sock',
    });
    expect(exitCode).toBe(0);
  });
});
