import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// PowerShell plays the role xdotool plays on Linux: window listing, focus and
// key injection, one short-lived process per operation. ~0.5s of startup per
// call is fine — everything here is triggered by a user click.

export const psQuote = (text) => `'${String(text ?? '').replace(/'/g, "''")}'`;

// SendKeys treats +^%~(){} as operators; newlines become spaces because
// {ENTER} would submit the prompt mid-text (Enter is sent separately).
export function escapeSendKeys(text) {
  return String(text ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[+^%~(){}]/g, (ch) => `{${ch}}`);
}

const ENUM_WINDOWS_TYPE = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static List<string> Windows() {
    var rows = new List<string>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(hWnd, sb, 512);
      var title = sb.ToString();
      if (title.Length == 0) return true;
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      rows.Add(hWnd.ToInt64() + "\\t" + pid + "\\t" + title.Replace("\\t", " "));
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}`;

export function listWindowsScript() {
  return [
    `Add-Type -TypeDefinition @'${'\n'}${ENUM_WINDOWS_TYPE}${'\n'}'@`,
    '[WinEnum]::Windows() | ForEach-Object {',
    '  $parts = $_ -split "`t",3',
    "  $exe = try { (Get-Process -Id ([int]$parts[1]) -ErrorAction Stop).ProcessName } catch { '' }",
    '  "$($parts[0])`t$exe`t$($parts[2])"',
    '}',
  ].join('\n');
}

// hwnd values are interpolated into scripts, so they must be pure integers.
function assertHwnd(id) {
  if (!/^\d+$/.test(String(id))) throw new Error(`bad hwnd: ${id}`);
  return String(id);
}

const FOCUS_TYPE = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}`;

export function activateWindowScript(id) {
  const hwnd = assertHwnd(id);
  return [
    `Add-Type -TypeDefinition @'${'\n'}${FOCUS_TYPE}${'\n'}'@`,
    `$h = [IntPtr]${hwnd}`,
    'if ([WinFocus]::IsIconic($h)) { [void][WinFocus]::ShowWindow($h, 9) }',
    '[void][WinFocus]::SetForegroundWindow($h)',
  ].join('\n');
}

export function getWindowTitleScript(id) {
  const hwnd = assertHwnd(id);
  return [
    `Add-Type -TypeDefinition @'${'\n'}${FOCUS_TYPE}${'\n'}'@`,
    '$sb = New-Object System.Text.StringBuilder 512',
    `[void][WinFocus]::GetWindowText([IntPtr]${hwnd}, $sb, 512)`,
    '$sb.ToString()',
  ].join('\n');
}

export function sendKeysScript(keys) {
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    `[System.Windows.Forms.SendKeys]::SendWait(${psQuote(keys)})`,
  ].join('\n');
}

function runPs(script, execFn) {
  return execFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

export function parseWindowList(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length === 3 && /^\d+$/.test(parts[0]))
    .map(([id, exe, title]) => ({ id, class: exe.toLowerCase(), title }));
}

export async function listWindows({ execFn = execFileAsync } = {}) {
  try {
    const { stdout } = await runPs(listWindowsScript(), execFn);
    return parseWindowList(stdout);
  } catch {
    return []; // powershell missing/blocked — the caller names the cause
  }
}

export async function activateWindow(id, { execFn = execFileAsync } = {}) {
  await runPs(activateWindowScript(id), execFn);
}

export async function getWindowTitle(id, { execFn = execFileAsync } = {}) {
  const { stdout } = await runPs(getWindowTitleScript(id), execFn);
  return String(stdout ?? '').trim();
}

export async function sendKeys(keys, { execFn = execFileAsync } = {}) {
  await runPs(sendKeysScript(keys), execFn);
}

export async function typeText(text, { execFn = execFileAsync } = {}) {
  await sendKeys(escapeSendKeys(text), { execFn });
}
