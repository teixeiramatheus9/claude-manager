import { describe, it, expect } from 'vitest';
import { addHooks, removeHooks, ensureHooks } from '../scripts/install-hooks.js';

const COMMAND = 'node "/home/user/Claude Manager/src/hook/hook-emit.js"';

describe('install-hooks', () => {
  it('adds one hook group per event', () => {
    const result = addHooks({}, COMMAND);
    for (const eventName of ['UserPromptSubmit', 'Stop', 'Notification']) {
      expect(result.hooks[eventName]).toEqual([
        { hooks: [{ type: 'command', command: COMMAND }] },
      ]);
    }
  });

  it('is idempotent', () => {
    const once = addHooks({}, COMMAND);
    const twice = addHooks(once, COMMAND);
    expect(twice.hooks.Stop).toHaveLength(1);
  });

  it('preserves unrelated settings and existing hooks', () => {
    const settings = {
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] },
    };
    const result = addHooks(settings, COMMAND);
    expect(result.model).toBe('opus');
    expect(result.hooks.Stop).toHaveLength(2);
    expect(result.hooks.Stop[0].hooks[0].command).toBe('other-tool');
  });

  it('ensureHooks replaces stale hook-emit variants and keeps other tools', () => {
    const stale = 'node "/old/path/src/hook/hook-emit.js"';
    const fresh = 'ELECTRON_RUN_AS_NODE=1 "/opt/Claude Manager/claude-manager" "/opt/app/src/hook/hook-emit.js"';
    const settings = addHooks(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } },
      stale,
    );
    const result = ensureHooks(settings, fresh);
    const stopCommands = result.hooks.Stop.flatMap((group) => group.hooks.map((h) => h.command));
    expect(stopCommands).toContain('other-tool');
    expect(stopCommands).toContain(fresh);
    expect(stopCommands).not.toContain(stale);
  });

  it('ensureHooks is a no-op when the current command is already registered', () => {
    const command = 'node "/app/src/hook/hook-emit.js"';
    const once = ensureHooks({}, command);
    expect(ensureHooks(once, command)).toEqual(once);
  });

  it('removeHooks strips only our command and cleans empty groups', () => {
    const withOurs = addHooks(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } },
      COMMAND,
    );
    const removed = removeHooks(withOurs, COMMAND);
    expect(removed.hooks.Stop).toHaveLength(1);
    expect(removed.hooks.Stop[0].hooks[0].command).toBe('other-tool');
    expect(removed.hooks.UserPromptSubmit).toBeUndefined();
  });
});
