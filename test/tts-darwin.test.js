import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { speak, stopSpeaking } from '../src/main/tts-darwin.js';

function fakeChild() {
  const child = new EventEmitter();
  child.killed = null;
  child.kill = (signal) => {
    child.killed = signal;
  };
  return child;
}

describe('tts-darwin', () => {
  it('speaks with the pt-BR voice via say', () => {
    const calls = [];
    const spawnFn = (command, args) => {
      calls.push([command, args]);
      return fakeChild();
    };
    speak('olá', { spawnFn });
    expect(calls).toEqual([['say', ['-v', 'Luciana', '--', 'olá']]]);
    stopSpeaking();
  });

  it('falls back to the default voice when the pt-BR one fails', () => {
    const calls = [];
    const children = [];
    const spawnFn = (command, args) => {
      calls.push([command, args]);
      const child = fakeChild();
      children.push(child);
      return child;
    };
    speak('olá', { spawnFn });
    children[0].emit('exit', 1, null);
    expect(calls[1]).toEqual(['say', ['--', 'olá']]);
    stopSpeaking();
  });

  it('does not retry when the speech was killed', () => {
    const calls = [];
    const children = [];
    const spawnFn = (command, args) => {
      calls.push([command, args]);
      const child = fakeChild();
      children.push(child);
      return child;
    };
    speak('olá', { spawnFn });
    stopSpeaking();
    expect(children[0].killed).toBe('SIGKILL');
    children[0].emit('exit', null, 'SIGKILL');
    expect(calls).toHaveLength(1);
  });
});
