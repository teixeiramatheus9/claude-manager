import { describe, expect, it } from 'vitest';
import { linuxFocusHint, win32FocusHint } from '../src/main/focus-hints.js';

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

  it('every hint carries a spoken line for the manager voice', () => {
    for (const hint of [
      linuxFocusHint({ cause: 'no-x-windows' }, null),
      linuxFocusHint({ tabFound: false, cause: null }, { KITTY_WINDOW_ID: '3' }),
    ]) {
      expect(hint.speech).toBeTruthy();
    }
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

describe('win32FocusHint', () => {
  it('asks about powershell when the native layer failed', () => {
    const hint = win32FocusHint({ focused: false, tabFound: false, cause: 'powershell-failed' });
    expect(hint?.key).toBe('powershell');
    expect(hint.speech).toBeTruthy();
  });

  it('points at hidden tab titles only after a hunt saw every tab and matched none', () => {
    const hint = win32FocusHint({ focused: true, tabFound: false, cause: 'no-tab-matched' });
    expect(hint?.key).toBe('tab-titles');
    expect(hint.body).toContain('suppressApplicationTitle');
    expect(hint.speech).toBeTruthy();
  });

  it('explains a refused foreground instead of blaming the tab titles', () => {
    const hint = win32FocusHint({ focused: true, tabFound: false, cause: 'focus-refused' });
    expect(hint?.key).toBe('focus-refused');
    expect(hint.body).not.toContain('suppressApplicationTitle');
    expect(hint.speech).toBeTruthy();
  });

  it('stays quiet when no tab hunt ever ran', () => {
    // WaveTerm's block-gone return and the plain "raised some window" return
    // both look like this — telling those users to unhide tab titles is noise.
    expect(win32FocusHint({ focused: true, tabFound: false, cause: null })).toBeNull();
  });

  it('stays quiet when the tab was found or no terminal exists', () => {
    expect(win32FocusHint({ focused: true, tabFound: true, cause: null })).toBeNull();
    expect(win32FocusHint({ focused: false, tabFound: false, cause: 'terminal-not-found' })).toBeNull();
    expect(win32FocusHint({ focused: false, tabFound: false, cause: 'no-windows' })).toBeNull();
  });
});
