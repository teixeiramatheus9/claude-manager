// Which window-management mode the app really got, as opposed to which one it
// asked for. Running under XWayland leaves XDG_SESSION_TYPE saying "wayland",
// so reading the env alone would keep the degraded mode on forever; and reading
// the switch alone would promise positioning to a process that never got an X
// display. Both have to agree.
export function resolveDisplayMode({ display, ozonePlatform, sessionType }) {
  if (!display) return { platform: 'wayland', managed: false };
  if (ozonePlatform === 'x11') return { platform: 'x11', managed: true };
  if (ozonePlatform === 'wayland') return { platform: 'wayland', managed: false };
  // No explicit switch: Electron follows the session, so trust the session type.
  return sessionType === 'wayland'
    ? { platform: 'wayland', managed: false }
    : { platform: 'x11', managed: true };
}
