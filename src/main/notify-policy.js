// Decides whether a session event deserves a bark (chime + voice + balloon)
// or just the silent card update. Pure on purpose: every input is a value.
//
// focused: true = the chat's terminal tab is the active window right now;
// false = it is definitely elsewhere; null = no way to tell (no xdotool, no
// bridge, macOS/Windows) — then the user's own setting decides, defaulting
// to "when in doubt, bark" (missing a notice is worse than a spare one).
export const REANNOUNCE_MS = 10 * 60_000;

export function shouldAnnounce({
  kind,
  text,
  focused,
  lastAnnouncement = null,
  announceWhenUnknown = true,
  now = 0,
} = {}) {
  if (focused === true) return { announce: false, reason: 'focused' };
  if (focused !== false && !announceWhenUnknown) {
    return { announce: false, reason: 'unknown-muted' };
  }
  // Claude Code fires a Notification ~60s after the Stop for the same state:
  // same text soon after is the same news. After the cooldown it barks again —
  // the user never showed up, a reminder is fair.
  if (
    kind === 'waiting' &&
    lastAnnouncement &&
    lastAnnouncement.text === text &&
    now - lastAnnouncement.at < REANNOUNCE_MS
  ) {
    return { announce: false, reason: 'repeat' };
  }
  return { announce: true, reason: null };
}
