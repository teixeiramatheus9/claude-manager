import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

export function startSocketServer(socketPath, onEvent, log) {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // no stale socket, fine
  }

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch (error) {
          log(`socket-server: dropped bad line: ${error}`);
        }
      }
    });
    socket.on('error', () => {
      // client went away mid-write; nothing to do
    });
  });

  server.on('error', (error) => log(`socket-server: ${error}`));
  server.listen(socketPath);
  return server;
}

// The socket file used to be left behind on quit — only the next start cleaned
// it up, and only because it unlinks a stale one before listening.
export function stopSocketServer(server, socketPath) {
  try {
    server?.close();
  } catch {
    // never listened
  }
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // already gone
  }
}
