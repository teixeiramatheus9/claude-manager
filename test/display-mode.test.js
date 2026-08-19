import { describe, it, expect } from 'vitest';
import { resolveDisplayMode } from '../src/main/display-mode.js';

describe('display mode', () => {
  it('is managed when the x11 switch was passed and a display exists', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: 'x11', sessionType: 'wayland' })).toEqual(
      { platform: 'x11', managed: true },
    );
  });

  it('degrades when the x11 switch was passed but no display is reachable', () => {
    expect(resolveDisplayMode({ display: '', ozonePlatform: 'x11', sessionType: 'wayland' })).toEqual(
      { platform: 'wayland', managed: false },
    );
  });

  // The whole point of the module: someone running `electron .` by hand gets no
  // switch, so the app really is on native Wayland and must not pretend it can
  // position its own window.
  it('degrades on a wayland session when no switch was passed', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: 'wayland' })).toEqual(
      { platform: 'wayland', managed: false },
    );
  });

  it('is managed on a real x11 session even without an explicit switch', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: 'x11' })).toEqual({
      platform: 'x11',
      managed: true,
    });
  });

  it('honours an explicit wayland switch over the session type', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: 'wayland', sessionType: 'x11' })).toEqual(
      { platform: 'wayland', managed: false },
    );
  });

  it('treats a missing session type with a display as x11', () => {
    expect(resolveDisplayMode({ display: ':0', ozonePlatform: '', sessionType: undefined })).toEqual({
      platform: 'x11',
      managed: true,
    });
  });
});
