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

// ANSI-argv console tools (like sherpa-onnx) receive their command line
// converted from UTF-16 to the system codepage and then read it as UTF-8, so
// every accent turns into garbage syllables. On a cp1252 system the fix is to
// pre-encode: send the chars whose cp1252 bytes ARE the text's UTF-8 bytes —
// the child's CRT conversion then reconstructs valid UTF-8. On a UTF-8 system
// (ACP 65001) the conversion is already lossless; on any other codepage the
// trick would corrupt, so accents are stripped instead of spoken wrong.
const CP1252_BYTE_TO_CHAR = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

export function encodeAnsiArgvText(text, ansiCodepage) {
  const value = String(text ?? '');
  if (ansiCodepage === 65001) return value;
  if (ansiCodepage === 1252) {
    return Array.from(Buffer.from(value, 'utf8'))
      .map((byte) => String.fromCharCode(CP1252_BYTE_TO_CHAR[byte] ?? byte))
      .join('');
  }
  // NFD splits the accents off so they can be dropped; everything else stays.
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// The ANSI codepage comes from the registry; execSync is fine because this is
// read once per process and cached by the caller (TTS already takes seconds).
export function readAnsiCodepage(execFileSyncFn) {
  try {
    const stdout = execFileSyncFn('reg', [
      'query',
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
      '/v',
      'ACP',
    ]);
    const match = String(stdout).match(/ACP\s+REG_SZ\s+(\d+)/);
    return match ? Number(match[1]) : 1252;
  } catch {
    return 1252; // the western default is also the safe disguise target
  }
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
    '  "$($parts[0])`t$($parts[1])`t$exe`t$($parts[2])"',
    '}',
  ].join('\n');
}

// pids are interpolated into scripts, so they must be pure integers.
function assertPid(pid) {
  if (!/^\d+$/.test(String(pid))) throw new Error(`bad pid: ${pid}`);
  return String(pid);
}

// Climbs the parent chain of a process (claude → shell → terminal), one pid
// per output line. Capped and cycle-guarded: Windows recycles pids, so a
// stale ParentProcessId can point anywhere.
export function processAncestorsScript(pid) {
  const start = assertPid(pid);
  return [
    `$current = ${start}`,
    '$seen = @{}',
    'for ($i = 0; $i -lt 20 -and $current -and -not $seen.ContainsKey($current)) {',
    '  $seen[$current] = $true',
    '  $current',
    '  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue',
    '  if (-not $proc) { break }',
    '  $current = $proc.ParentProcessId',
    '  $i++',
    '}',
  ].join('\n');
}

export function parseProcessAncestors(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
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

// SendKeys is global — it reaches whatever window is in front. Windows can
// refuse SetForegroundWindow (foreground lock), so every injection has to
// confirm the target actually got there, or the keys hit the user's browser.
const FOREGROUND_TYPE = `
using System;
using System.Runtime.InteropServices;
public class WinFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}`;

export function foregroundWindowScript() {
  return [
    `Add-Type -TypeDefinition @'${'\n'}${FOREGROUND_TYPE}${'\n'}'@`,
    '[WinFg]::GetForegroundWindow().ToInt64()',
  ].join('\n');
}

export async function getForegroundWindow({ execFn = execFileAsync } = {}) {
  try {
    const { stdout } = await runPs(foregroundWindowScript(), execFn);
    const value = String(stdout ?? '').trim();
    return /^\d+$/.test(value) ? value : null;
  } catch {
    return null; // unknown foreground — the caller treats that as "do not type"
  }
}

// Reading the tabs one PowerShell process per keypress costs ~200ms of startup
// each — on a terminal with a few tabs that is seconds of visible flipping.
// This walks every tab INSIDE one process (~65ms per tab) using the terminal's
// own "go to tab N" shortcut, so the caller learns each tab's index in a single
// round trip and can jump straight there next time. It re-checks the foreground
// on every step: if the user clicks away mid-walk it stops instead of typing
// into whatever took over. `jumpKey` is a SendKeys template with {n} for the
// index (Warp: "^{n}", Windows Terminal: "^%{n}").
// SendKeys reads "^10" as Ctrl+1 followed by a literal "0" — that stray digit
// would land in the user's prompt — so the jump shortcuts stop at 9, which is
// also where every terminal stops binding them.
export const MAX_JUMP_TABS = 9;

export function tabTitlesScript(id, { maxTabs = MAX_JUMP_TABS, jumpKey } = {}) {
  const hwnd = assertHwnd(id);
  const jumps = [];
  for (let index = 1; index <= Math.min(maxTabs, MAX_JUMP_TABS); index++) {
    const keys = String(jumpKey).replace('{n}', String(index));
    jumps.push(
      [
        `  if ([WinTabs]::GetForegroundWindow() -ne $h) { 'ABORT'; break }`,
        `  [System.Windows.Forms.SendKeys]::SendWait(${psQuote(keys)})`,
        `  Start-Sleep -Milliseconds $delay`,
        `  $title = Title`,
        // the same title twice means the index ran past the last tab
        `  if ($title -eq $previous) { break }`,
        `  $previous = $title`,
        `  "${index}\`t$title"`,
      ].join('\n'),
    );
  }
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    `Add-Type -TypeDefinition @'${'\n'}${TAB_WALK_TYPE}${'\n'}'@`,
    `$h = [IntPtr]${hwnd}`,
    '$delay = 90',
    '$previous = $null',
    'function Title { $sb = New-Object System.Text.StringBuilder 512; ' +
      '[void][WinTabs]::GetWindowText($h, $sb, 512); $sb.ToString() }',
    'do {',
    jumps.join('\n'),
    '} while ($false)',
  ].join('\n');
}

const TAB_WALK_TYPE = `
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinTabs {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}`;

// The walk stops and says ABORT when the user clicks away mid-walk. Losing
// that fact would let the caller report "every tab was seen" after seeing one.
export function walkWasAborted(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .some((line) => line.trim() === 'ABORT');
}

export function parseTabTitles(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length === 2 && /^\d+$/.test(parts[0]))
    .map(([index, title]) => ({ index: Number(index), title }));
}

export async function readTabTitles(id, { execFn = execFileAsync, ...options } = {}) {
  try {
    const { stdout } = await runPs(tabTitlesScript(id, options), execFn);
    const tabs = parseTabTitles(stdout);
    // aborted is carried on the array so the shape stays a plain list for
    // every caller that only cares about the titles
    tabs.aborted = walkWasAborted(stdout);
    return tabs;
  } catch {
    return []; // no walk — the caller falls back to cycling with Ctrl+Tab
  }
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
    .filter((parts) => parts.length === 4 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]))
    .map(([id, pid, exe, title]) => ({ id, pid: Number(pid), class: exe.toLowerCase(), title }));
}

export async function listWindows({ execFn = execFileAsync } = {}) {
  try {
    const { stdout } = await runPs(listWindowsScript(), execFn);
    return parseWindowList(stdout);
  } catch {
    return []; // powershell missing/blocked — the caller names the cause
  }
}

export async function listProcessAncestors(pid, { execFn = execFileAsync } = {}) {
  try {
    const { stdout } = await runPs(processAncestorsScript(pid), execFn);
    return parseProcessAncestors(stdout);
  } catch {
    return []; // bad pid or powershell blocked — the hunt just stays unscoped
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
