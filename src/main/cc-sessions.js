import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Claude Code registers every live session here: one <pid>.json carrying the
// messaging socket path, plus a sibling <pid>.<hash>.key holding that session's
// auth token. The sessionId in the json is the same id the hooks report, which
// is what lets the manager address a session without touching its window.
export const claudeSessionsDir = path.join(os.homedir(), '.claude', 'sessions');

export function parseSessionRecord(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const pid = raw?.pid;
  const sessionId = raw?.sessionId;
  const socketPath = raw?.messagingSocketPath;
  if (!Number.isInteger(pid) || typeof sessionId !== 'string' || !sessionId) return null;
  if (typeof socketPath !== 'string' || !socketPath) return null;
  return {
    pid,
    sessionId,
    socketPath,
    procStart: typeof raw.procStart === 'string' ? raw.procStart : null,
    peerProtocol: typeof raw.peerProtocol === 'number' ? raw.peerProtocol : null,
    name: typeof raw.name === 'string' ? raw.name : null,
    status: typeof raw.status === 'string' ? raw.status : null,
  };
}

// Protocol 1 is the only wire format this app knows how to speak. Anything else
// means Claude Code changed it, and writing to the socket anyway would be worse
// than falling back to the terminal.
export function isSupported(record) {
  return Boolean(record) && record.peerProtocol === 1 && Boolean(record.socketPath);
}

// Field 22 of /proc/<pid>/stat is the process start time in clock ticks, which
// Claude Code copies into procStart. Comparing them rejects a recycled pid.
// The comm field (field 2) is parenthesised and can contain spaces, so counting
// starts after the last closing paren, where the next token is field 3 — which
// puts field 22 at index 19.
export function procStartFromStat(statText) {
  const text = String(statText ?? '');
  const tail = text
    .slice(text.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  return tail[19] ?? null;
}

export function parsePeerKey(text) {
  try {
    const token = JSON.parse(text)?.peerToken;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

function defaultProcStartFor(pid) {
  try {
    return procStartFromStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

// Resolves a hook-reported sessionId to everything needed to talk to that
// session's socket, or null when there is no usable channel — in which case the
// caller falls back to driving the terminal window.
export function readSessionChannel(
  sessionId,
  {
    dir = claudeSessionsDir,
    readdirSync = fs.readdirSync,
    readFileSync = fs.readFileSync,
    procStartFor = defaultProcStartFor,
  } = {},
) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null; // no registry at all — this Claude Code build predates it
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    let record;
    try {
      record = parseSessionRecord(readFileSync(path.join(dir, entry), 'utf8'));
    } catch {
      continue;
    }
    if (!record || record.sessionId !== sessionId || !isSupported(record)) continue;
    if (record.procStart && procStartFor(record.pid) !== record.procStart) continue;

    const keyEntry = entries.find(
      (name) => name.startsWith(`${record.pid}.`) && name.endsWith('.key'),
    );
    let token = null;
    if (keyEntry) {
      try {
        token = parsePeerKey(readFileSync(path.join(dir, keyEntry), 'utf8'));
      } catch {
        token = null; // unreadable key: auth is optional on some builds, so try anyway
      }
    }
    return {
      socketPath: record.socketPath,
      token,
      pid: record.pid,
      name: record.name,
      status: record.status,
    };
  }
  return null;
}
