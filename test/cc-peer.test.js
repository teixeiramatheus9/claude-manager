import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFrames, sendUserMessage } from '../src/main/cc-peer.js';

// Stands in for a live Claude Code session: collects every newline-delimited
// frame a client writes to a throwaway socket.
async function withFakeSession(handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-peer-'));
  const socketPath = path.join(dir, 'peer.sock');
  const received = [];
  const server = net.createServer((connection) => {
    let buffer = '';
    connection.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) received.push(JSON.parse(line));
        newline = buffer.indexOf('\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    return await handler({ socketPath, received });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('claude code peer channel', () => {
  it('builds the auth line before the user line when a token exists', () => {
    expect(buildFrames({ text: 'oi', token: 'tok', msgId: 'm1' })).toEqual([
      '{"type":"auth","token":"tok"}',
      '{"type":"user","msg_id":"m1","message":{"role":"user","content":"oi"}}',
    ]);
  });

  it('omits the auth line when there is no token', () => {
    expect(buildFrames({ text: 'oi', token: null, msgId: 'm1' })).toEqual([
      '{"type":"user","msg_id":"m1","message":{"role":"user","content":"oi"}}',
    ]);
  });

  it('delivers both frames to a listening session', async () => {
    const result = await withFakeSession(async ({ socketPath, received }) => {
      const outcome = await sendUserMessage(socketPath, 'faz o deploy', {
        token: 'tok',
        msgId: 'm1',
      });
      // Give the server loop a tick to drain what was written.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { outcome, received: [...received] };
    });
    expect(result.outcome).toBe('sent');
    expect(result.received).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'user', msg_id: 'm1', message: { role: 'user', content: 'faz o deploy' } },
    ]);
  });

  it('reports no-channel when nothing is listening on the path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-peer-'));
    const outcome = await sendUserMessage(path.join(dir, 'missing.sock'), 'oi', { msgId: 'm1' });
    expect(outcome).toBe('no-channel');
  });

  // Documents a limitation rather than a wish: a peer that accepts the
  // connection and destroys it (what Claude Code does to a frame it will not
  // take) looks EXACTLY like a clean close on a unix socket — end, then close
  // with hadError=false, no ECONNRESET. So this returns 'sent', and 'sent' can
  // never be reported to the user as "delivered". Do not "fix" this by guessing.
  it('cannot tell a teardown from a clean close, so it still reports sent', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-peer-'));
    const socketPath = path.join(dir, 'hostile.sock');
    const server = net.createServer((connection) => {
      connection.on('data', () => connection.destroy());
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    try {
      expect(await sendUserMessage(socketPath, 'oi', { msgId: 'm3' })).toBe('sent');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('refuses empty text without opening a connection', async () => {
    expect(await sendUserMessage('/nonexistent/should-not-be-touched.sock', '   ')).toBe('failed');
  });

  it('trims the text before sending it', async () => {
    const result = await withFakeSession(async ({ socketPath, received }) => {
      await sendUserMessage(socketPath, '  com espaco  ', { msgId: 'm2' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return [...received];
    });
    expect(result[0].message.content).toBe('com espaco');
  });
});
