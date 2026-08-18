import { describe, it, expect, vi } from 'vitest';
import net from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startSocketServer } from '../src/main/socket-server.js';

function sendLines(socketFile, payload) {
  return new Promise((resolve, reject) => {
    const client = net.connect(socketFile, () => client.end(payload));
    client.on('close', resolve);
    client.on('error', reject);
  });
}

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('socket server', () => {
  it('parses one JSON event per line', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-server-'));
    const socketFile = path.join(dir, 'srv.sock');
    const onEvent = vi.fn();
    const server = startSocketServer(socketFile, onEvent, () => {});
    await new Promise((resolve) => server.on('listening', resolve));

    await sendLines(socketFile, '{"a":1}\n{"b":2}\n');
    await waitTick();
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledWith({ a: 1 });
    expect(onEvent).toHaveBeenCalledWith({ b: 2 });
    server.close();
  });

  it('skips malformed lines and keeps going', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-server-'));
    const socketFile = path.join(dir, 'srv.sock');
    const onEvent = vi.fn();
    const logFn = vi.fn();
    const server = startSocketServer(socketFile, onEvent, logFn);
    await new Promise((resolve) => server.on('listening', resolve));

    await sendLines(socketFile, 'garbage\n{"ok":true}\n');
    await waitTick();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ ok: true });
    expect(logFn).toHaveBeenCalled();
    server.close();
  });

  it('replaces a stale socket file on startup', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-server-'));
    const socketFile = path.join(dir, 'srv.sock');
    const first = startSocketServer(socketFile, () => {}, () => {});
    await new Promise((resolve) => first.on('listening', resolve));
    await new Promise((resolve) => first.close(resolve));

    const second = startSocketServer(socketFile, () => {}, () => {});
    await new Promise((resolve, reject) => {
      second.on('listening', resolve);
      second.on('error', reject);
    });
    second.close();
  });
});
