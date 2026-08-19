// Which window-management mode the app really got, as opposed to which one it
// asked for. Running under XWayland leaves XDG_SESSION_TYPE saying "wayland",
// so reading the env alone would keep the degraded mode on forever; and reading
// the switch alone would promise positioning to a process that never got an X
// display. Both have to agree.
export function resolveDisplayMode({ display, ozonePlatform, sessionType }) {
  // XTEST — what xdotool uses to type and press keys in OTHER apps — is a
  // property of the session, not of this window: xdotool is a separate process
  // talking to the X server. On a real X11 session it is unrestricted. Under
  // XWayland the compositor gates it behind the RemoteDesktop portal (GNOME 49
  // shows a remote-access consent dialog and the keystrokes still never land),
  // so the app must not try. Positioning and injection are therefore separate
  // capabilities: under XWayland the app can place its own window but cannot
  // type into anyone else's.
  const canInjectInput = Boolean(display) && sessionType !== 'wayland';

  if (!display) return { platform: 'wayland', managed: false, canInjectInput };
  if (ozonePlatform === 'x11') return { platform: 'x11', managed: true, canInjectInput };
  if (ozonePlatform === 'wayland') return { platform: 'wayland', managed: false, canInjectInput };
  // No explicit switch: Electron follows the session, so trust the session type.
  return sessionType === 'wayland'
    ? { platform: 'wayland', managed: false, canInjectInput }
    : { platform: 'x11', managed: true, canInjectInput };
}

// build.linux.executableArgs never reaches the AppImage: the AppRun that
// electron-builder generates only forwards --no-sandbox. A packaged download
// would therefore lose XWayland silently — no overlay, no drag, no persisted
// position. Chromium reads the switch before main.js runs, so the only way to
// guarantee it on every launch path (AppImage, deb, rpm, `electron .`) is to
// relaunch once with it.
//
// switchPassed MUST come from process.argv, not from the command-line store:
// Chromium populates ozone-platform with whatever platform it auto-selected, so
// getSwitchValue returns "wayland" and hasSwitch returns true even when nobody
// passed the flag. Only argv distinguishes "chosen" from "defaulted".
export function shouldRelaunchUnderX11({ display, platform, switchPassed, alreadyRelaunched }) {
  if (alreadyRelaunched) return false;
  if (switchPassed) return false; // an explicit choice, either way, is honoured
  if (!display) return false; // nothing to relaunch into
  return platform === 'wayland'; // already on x11 means nothing to gain
}
