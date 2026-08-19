import { describe, it, expect, vi } from 'vitest';
import {
  psQuote,
  escapeSendKeys,
  parseWindowList,
  listWindows,
  activateWindowScript,
  sendKeysScript,
} from '../src/main/win32-native.js';

describe('psQuote', () => {
  it('wraps in single quotes and doubles embedded quotes', () => {
    expect(psQuote("it's done")).toBe("'it''s done'");
  });
});

describe('escapeSendKeys', () => {
  it('braces SendKeys metacharacters', () => {
    expect(escapeSendKeys('a+b^c%d~e(f)g{h}i')).toBe('a{+}b{^}c{%}d{~}e{(}f{)}g{{}h{}}i');
  });
  it('turns newlines into spaces so a reply is never submitted mid-text', () => {
    expect(escapeSendKeys('line1\nline2\r\nline3')).toBe('line1 line2 line3');
  });
});

describe('parseWindowList', () => {
  it('parses hwnd/exe/title TSV lines', () => {
    const stdout = '132456\tWindowsTerminal\tclaude-manager — claude\n789\twarp\tWarp\n';
    expect(parseWindowList(stdout)).toEqual([
      { id: '132456', class: 'windowsterminal', title: 'claude-manager — claude' },
      { id: '789', class: 'warp', title: 'Warp' },
    ]);
  });
  it('skips malformed lines', () => {
    expect(parseWindowList('garbage\n\n42\texe\ttitle\n')).toEqual([
      { id: '42', class: 'exe', title: 'title' },
    ]);
  });
});

describe('listWindows', () => {
  it('runs powershell and parses the output', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '7\tWindowsTerminal\thello\n' });
    const windows = await listWindows({ execFn });
    expect(execFn).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      expect.stringContaining('EnumWindows'),
    ]);
    expect(windows).toEqual([{ id: '7', class: 'windowsterminal', title: 'hello' }]);
  });
  it('returns [] when powershell fails', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('nope'));
    expect(await listWindows({ execFn })).toEqual([]);
  });
});

describe('script builders', () => {
  it('activateWindowScript validates the hwnd as a number', () => {
    expect(activateWindowScript('1234')).toContain('[IntPtr]1234');
    expect(() => activateWindowScript('12; rm x')).toThrow();
  });
  it('sendKeysScript embeds the keys as a PS literal', () => {
    expect(sendKeysScript('^{TAB}')).toContain("SendWait('^{TAB}')");
    expect(sendKeysScript("o'clock")).toContain("SendWait('o''clock')");
  });
});
