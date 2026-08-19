import { describe, it, expect } from 'vitest';
import {
  parseSessionRecord,
  isSupported,
  procStartFromStat,
  parsePeerKey,
  readSessionChannel,
} from '../src/main/cc-sessions.js';

const SESSION_ID = '4b706711-9840-4931-8b0f-d6d51518d6ba';

const RECORD = JSON.stringify({
  pid: 103483,
  sessionId: SESSION_ID,
  cwd: '/home/user/project',
  procStart: '43021813',
  version: '2.1.235',
  peerProtocol: 1,
  kind: 'interactive',
  messagingSocketPath: '/run/user/1000/cc-socks/103483.sock',
  name: 'claude-manager-28',
  status: 'busy',
});

describe('claude code session registry', () => {
  it('parses the fields the channel needs', () => {
    expect(parseSessionRecord(RECORD)).toEqual({
      pid: 103483,
      sessionId: SESSION_ID,
      socketPath: '/run/user/1000/cc-socks/103483.sock',
      procStart: '43021813',
      peerProtocol: 1,
      name: 'claude-manager-28',
      status: 'busy',
    });
  });

  it('rejects junk and records without a socket', () => {
    expect(parseSessionRecord('not json')).toBeNull();
    expect(parseSessionRecord(JSON.stringify({ pid: 1, sessionId: 'a' }))).toBeNull();
  });

  it('only supports protocol 1', () => {
    const record = parseSessionRecord(RECORD);
    expect(isSupported(record)).toBe(true);
    expect(isSupported({ ...record, peerProtocol: 2 })).toBe(false);
    expect(isSupported(null)).toBe(false);
  });

  // Field 22 of /proc/<pid>/stat. The comm field is parenthesised and may hold
  // spaces, so parsing counts from the closing paren.
  it('reads the process start time out of a stat line', () => {
    const middle = Array.from({ length: 12 }, (_, index) => index).join(' ');
    const stat = `103483 (claude code) S 1 2 3 4 -1 4194304 ${middle} 43021813 rest here`;
    expect(procStartFromStat(stat)).toBe('43021813');
  });

  it('reads the peer token', () => {
    expect(parsePeerKey('{"peerToken":"abc123","procStart":"43021813"}')).toBe('abc123');
    expect(parsePeerKey('{"procStart":"1"}')).toBeNull();
    expect(parsePeerKey('nope')).toBeNull();
  });

  it('resolves a live session to its socket and token', () => {
    const channel = readSessionChannel(SESSION_ID, {
      readdirSync: () => ['103483.json', '103483.deadbeef.key'],
      readFileSync: (file) =>
        String(file).endsWith('.key') ? '{"peerToken":"tok","procStart":"43021813"}' : RECORD,
      procStartFor: () => '43021813',
    });
    expect(channel).toEqual({
      socketPath: '/run/user/1000/cc-socks/103483.sock',
      token: 'tok',
      pid: 103483,
      name: 'claude-manager-28',
      status: 'busy',
    });
  });

  // A recycled pid would otherwise point the channel at an unrelated process.
  it('rejects a session whose pid was recycled', () => {
    const channel = readSessionChannel(SESSION_ID, {
      readdirSync: () => ['103483.json'],
      readFileSync: () => RECORD,
      procStartFor: () => '99999999',
    });
    expect(channel).toBeNull();
  });

  it('returns null for an unknown session id', () => {
    const channel = readSessionChannel('nope', {
      readdirSync: () => ['103483.json'],
      readFileSync: () => RECORD,
      procStartFor: () => '43021813',
    });
    expect(channel).toBeNull();
  });

  // Auth is optional on some builds; a missing key file must not kill the send.
  it('resolves without a token when there is no key file', () => {
    const channel = readSessionChannel(SESSION_ID, {
      readdirSync: () => ['103483.json'],
      readFileSync: () => RECORD,
      procStartFor: () => '43021813',
    });
    expect(channel?.token).toBeNull();
  });

  it('returns null when the registry directory is unreadable', () => {
    const channel = readSessionChannel(SESSION_ID, {
      readdirSync: () => {
        throw new Error('ENOENT');
      },
    });
    expect(channel).toBeNull();
  });
});
