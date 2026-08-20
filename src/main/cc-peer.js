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
// Who the receiving chat sees in <cross-session-message from="...">. Without
// this field the session shows the message as from="unknown". The receiver
// only accepts [A-Za-z0-9%:_/.\-] here, and the value doubles as a reply
// address for sessions that run a listening socket — this app does not, so it
// is a pure identity: the user's own quick reply, relayed verbatim.
export const PEER_FROM = 'vizor/resposta-do-usuario';

export function buildFrames({ text, token, msgId, priority }) {
  const frames = [];
  if (token) frames.push(JSON.stringify({ type: 'auth', token }));
  frames.push(
    JSON.stringify({
      type: 'user',
      msg_id: msgId,
      from: PEER_FROM,
      // 'now' makes the reply jump the session's queue instead of waiting for
      // the current turn to finish; omitted, the receiver defaults to 'next'.
      ...(priority ? { priority } : {}),
      message: { role: 'user', content: text },
    }),
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
    priority = null,
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
      socket.end(`${buildFrames({ text: content, token, msgId, priority }).join('\n')}\n`);
    });
    // There is deliberately no attempt to tell acceptance from rejection here.
    // On a unix socket a peer destroy() is INDISTINGUISHABLE from a clean close:
    // the client observes end -> close with hadError=false either way, no
    // ECONNRESET (verified by probe). So 'sent' means "handed to the socket",
    // never "delivered" — which is why the panel must not claim delivery. Real
    // confirmation would need either the protocol's receipts (their reply-address
    // field is not confirmed) or reading the target session's transcript back.
    socket.on('close', () => {
      clearTimeout(timer);
      finish('sent');
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      // A missing or unbound socket file means the session is simply gone.
      const missing = error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED';
      finish(missing ? 'no-channel' : 'failed');
    });
  });
}
