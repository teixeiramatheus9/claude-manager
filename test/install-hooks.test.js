import { describe, it, expect } from 'vitest';
import { addHooks, removeHooks } from '../scripts/install-hooks.js';

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
