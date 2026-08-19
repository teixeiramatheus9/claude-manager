import { describe, it, expect } from 'vitest';
import { resolveDisplayMode, shouldRelaunchUnderX11 } from '../src/main/display-mode.js';

describe('display mode', () => {
  it('is managed when the x11 switch was passed and a display exists', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: 'x11', sessionType: 'wayland' })).toEqual(
      { platform: 'x11', managed: true, canInjectInput: false },
    );
  });

  it('degrades when the x11 switch was passed but no display is reachable', () => {
    expect(resolveDisplayMode({ display: '', ozonePlatform: 'x11', sessionType: 'wayland' })).toEqual(
      { platform: 'wayland', managed: false, canInjectInput: false },
    );
  });

  // The whole point of the module: someone running `electron .` by hand gets no
  // switch, so the app really is on native Wayland and must not pretend it can
  // position its own window.
  it('degrades on a wayland session when no switch was passed', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: 'wayland' })).toEqual(
      { platform: 'wayland', managed: false, canInjectInput: false },
    );
  });

  it('is managed on a real x11 session even without an explicit switch', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: 'x11' })).toEqual({
      platform: 'x11',
      managed: true,
      canInjectInput: true,
    });
  });

  // Our own window runs on Wayland here, but the session still has a real X
  // server, so xdotool (a separate process) can still inject input.
  it('honours an explicit wayland switch over the session type', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: 'wayland', sessionType: 'x11' })).toEqual(
      { platform: 'wayland', managed: false, canInjectInput: true },
    );
  });

  it('treats a missing session type with a display as x11', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: undefined })).toEqual({
      platform: 'x11',
      managed: true,
      canInjectInput: true,
    });
  });
});

// XTEST (what xdotool uses to type and press keys) is unrestricted on a real
// X11 session, but under XWayland the compositor gates it behind the
// RemoteDesktop portal: GNOME 49 shows a remote-access consent dialog and the
// keystrokes still never arrive. So input injection has to be decided
// separately from window positioning — under XWayland the app can position its
// own window but must not try to type into anyone else's.
describe('input injection', () => {
  it('is allowed on a real x11 session', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: 'x11' }).canInjectInput).toBe(true);
  });

  it('is refused under XWayland even though positioning works', () => {
    const mode = resolveDisplayMode({ display: ':0', ozonePlatform: 'x11', sessionType: 'wayland' });
    expect(mode.managed).toBe(true);
    expect(mode.canInjectInput).toBe(false);
  });

  it('is refused on native wayland', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: 'wayland' }).canInjectInput).toBe(false);
  });

  it('is refused without a display', () => {
    expect(resolveDisplayMode({ display: '', ozonePlatform: 'x11', sessionType: 'x11' }).canInjectInput).toBe(false);
  });
});

// Chromium populates the ozone-platform switch with the platform it
// auto-selected, so getSwitchValue reports "wayland" and hasSwitch reports true
// even when the flag was never passed (verified by probe). Only process.argv
// tells whether somebody actually chose it — hence switchPassed.
describe('relaunching under x11', () => {
  const base = { display: ':0', platform: 'wayland', switchPassed: false, alreadyRelaunched: false };

  it('relaunches when running on wayland and nobody passed the flag', () => {
    expect(shouldRelaunchUnderX11(base)).toBe(true);
  });

  it('does not relaunch twice', () => {
    expect(shouldRelaunchUnderX11({ ...base, alreadyRelaunched: true })).toBe(false);
  });

  it('does not relaunch when the flag was actually passed', () => {
    expect(shouldRelaunchUnderX11({ ...base, switchPassed: true })).toBe(false);
  });

  it('does not relaunch without a display to relaunch into', () => {
    expect(shouldRelaunchUnderX11({ ...base, display: '' })).toBe(false);
  });

  it('does not relaunch when already on x11', () => {
    expect(shouldRelaunchUnderX11({ ...base, platform: 'x11' })).toBe(false);
  });
});
