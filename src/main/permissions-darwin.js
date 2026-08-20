import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ACCESSIBILITY_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
export const AUTOMATION_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

// AppleEvents refusals come back as osascript errors: -1743 is "the user
// denied automation for this target"; -1744 is "consent was never asked".
export function automationOutcomeFromError(error) {
  const text = `${error?.stderr ?? ''} ${error?.message ?? ''}`;
  if (text.includes('-1743')) return 'denied';
  if (text.includes('-1744')) return 'pending';
  return 'unknown';
}

// One harmless AppleEvent to System Events: enough to make macOS show the
// Automation consent prompt when it never asked before, and to tell apart
// granted/denied when it already did.
export async function probeSystemEventsAutomation({ execFn = execFileAsync } = {}) {
  try {
    await execFn('osascript', ['-e', 'tell application "System Events" to count processes']);
    return 'granted';
  } catch (error) {
    return automationOutcomeFromError(error);
  }
}
