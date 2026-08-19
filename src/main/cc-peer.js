import net from 'node:net';
import { randomUUID } from 'node:crypto';

const SEND_TIMEOUT_MS = 4000;

// The wire format is newline-delimited JSON, documented by Claude Code's own
// debug line:
//   { echo '{"type":"auth","token":"…"}';
//     echo '{"type":"user","message":{"role":"user","content":"hello"}}'; } \
//     | socat - UNIX-CONNECT:<sock>
// The auth line is only required on some builds, so it is sent whenever a token
// is available and omitted otherwise.
export function buildFrames({ text, token, msgId }) {
  const frames = [];
  if (token) frames.push(JSON.stringify({ type: 'auth', token }));
  frames.push(
    JSON.stringify({ type: 'user', msg_id: msgId, message: { role: 'user', content: text } }),
  );
  return frames;
}

// Fire-and-forget: resolves once the frames are flushed and the socket closes
// cleanly. The protocol does have delivery receipts (peer_message_status with
// delivered/held/denied/expired), but they are sent to a reply address whose
// field name is not confirmed, so they are deliberately not used here. Unlike
// typing into a terminal, addressing by session id cannot hit the wrong chat,
// so "flushed" is a far stronger signal than it sounds.
export function sendUserMessage(
  socketPath,
  text,
  {
    token = null,
    msgId = randomUUID(),
    timeoutMs = SEND_TIMEOUT_MS,
    connect = net.createConnection,
  } = {},
) {
  const content = String(text ?? '').trim();
  if (!content || !socketPath) return Promise.resolve('failed');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let socket;
    try {
      socket = connect({ path: socketPath });
    } catch {
      finish('no-channel');
      return;
    }

    const timer = setTimeout(() => {
      socket.destroy();
      finish('failed');
    }, timeoutMs);
    timer.unref?.();

    socket.on('connect', () => {
      socket.end(`${buildFrames({ text: content, token, msgId }).join('\n')}\n`);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      finish('sent');
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      // A missing or unbound socket file means the session is gone; anything
      // else is a real failure and deserves a different message to the user.
      const missing = error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED';
      finish(missing ? 'no-channel' : 'failed');
    });
  });
}
