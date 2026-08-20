import { describe, expect, it } from 'vitest';
import { linuxFocusHint } from '../src/main/focus-hints.js';

describe('linuxFocusHint', () => {
  it('asks for xdotool when X listing failed', () => {
    expect(linuxFocusHint({ cause: 'no-x-windows' }, null)?.key).toBe('xdotool');
    expect(linuxFocusHint({ cause: 'xdotool-failed' }, null)?.key).toBe('xdotool');
  });

  it('points at allow_remote_control when kitty has no listener', () => {
    const hint = linuxFocusHint({ tabFound: false, cause: null }, { KITTY_WINDOW_ID: '3' });
    expect(hint?.key).toBe('kitty-remote');
    expect(hint.body).toContain('allow_remote_control');
  });

  it('stays quiet when the tab was found or nothing is actionable', () => {
    expect(
      linuxFocusHint(
        { tabFound: true, cause: null },
        { KITTY_WINDOW_ID: '3' }, // found via title hunt — no nagging
      ),
    ).toBeNull();
    expect(
      linuxFocusHint(
        { tabFound: false, cause: null },
        { KITTY_WINDOW_ID: '3', KITTY_LISTEN_ON: 'unix:/tmp/k' }, // config is fine
      ),
    ).toBeNull();
    expect(linuxFocusHint({ tabFound: false, cause: 'terminal-not-in-x' }, null)).toBeNull();
  });
});
