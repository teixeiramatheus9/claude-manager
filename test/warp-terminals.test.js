import { describe, it, expect } from 'vitest';
import { TERMINALS, focusChatTab } from '../src/main/warp.js';

describe('new terminal entries', () => {
  it('registers terminator and guake with tab keys', () => {
    expect(TERMINALS.terminator.nextTabKey).toBe('ctrl+Next');
    expect(TERMINALS.guake.summon).toEqual(['guake', '--show']);
    expect(TERMINALS.blackbox.classHint).toBe('blackbox');
  });

  it('summons guake before hunting its window', async () => {
    const calls = [];
    const execFn = async (command, args) => {
      calls.push([command, ...(args ?? [])].join(' '));
      if (command === 'wmctrl') return { stdout: '0x1 0 guake.Guake host bash' };
      return { stdout: '' };
    };
    await focusChatTab('qualquer-chat', { execFn, delayMs: 0, terminal: 'guake' });
    expect(calls[0]).toBe('guake --show');
  });
});
