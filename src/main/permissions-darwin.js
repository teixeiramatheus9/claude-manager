import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

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

// The app ships ad-hoc signed (issue #58), so every update changes its code
// signature and macOS quietly voids the Accessibility grant — while the pane
// keeps showing a toggled-on entry bound to the DEAD signature. Losing a grant
// the user had given is the fingerprint of exactly that.
export function accessibilityLostAfterUpdate(memory, nowGranted) {
  return Boolean(memory?.accessible) && !nowGranted;
}

// Wipes this app's stale Accessibility rows so the fresh consent ask registers
// a single clean entry instead of piling on the dead ones (4 were found live).
// AppleEvents entries are left alone: Automation grants survive updates.
export async function resetAccessibilityEntries(bundleId, { execFn = execFileAsync } = {}) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(bundleId ?? ''))) return false;
  try {
    await execFn('tccutil', ['reset', 'Accessibility', bundleId]);
    return true;
  } catch {
    return false; // tccutil refused — the re-ask below still guides the user
  }
}

export function readGrantMemory(file, { readFileSync = fs.readFileSync } = {}) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeGrantMemory(file, memory, { writeFileSync = fs.writeFileSync } = {}) {
  try {
    writeFileSync(file, JSON.stringify(memory));
  } catch {
    // read-only disk — worst case the renewal ask repeats next boot
  }
}
