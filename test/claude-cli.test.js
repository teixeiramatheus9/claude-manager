import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { killPendingClaude, runClaude } from '../src/main/claude-cli.js';

function hangingSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('close', null);
  };
  return { child, spawnFn: () => child };
}

describe('killPendingClaude', () => {
  it('kills a claude -p still running when the app is told to quit', async () => {
    const { child, spawnFn } = hangingSpawn();
    const pending = runClaude({ prompt: 'oi', spawnFn });
    killPendingClaude();
    expect(child.killed).toBe(true);
    expect(await pending).toBeNull();
  });

  it('does nothing when no child is in flight', () => {
    expect(() => killPendingClaude()).not.toThrow();
  });
});
