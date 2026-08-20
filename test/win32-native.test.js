import { describe, it, expect, vi } from 'vitest';
import {
  psQuote,
  escapeSendKeys,
  parseWindowList,
  parseProcessAncestors,
  processAncestorsScript,
  listWindows,
  listProcessAncestors,
  getForegroundWindow,
  foregroundWindowScript,
  tabTitlesScript,
  parseTabTitles,
  readTabTitles,
  walkWasAborted,
  activateWindowScript,
  sendKeysScript,
  encodeAnsiArgvText,
} from '../src/main/win32-native.js';

describe('encodeAnsiArgvText', () => {
  it('passes text through untouched on a UTF-8 system codepage', () => {
    expect(encodeAnsiArgvText('concluída', 65001)).toBe('concluída');
  });

  it('disguises UTF-8 bytes as cp1252 chars so the child CRT undoes it', () => {
    // 'í' U+00ED → UTF-8 C3 AD → cp1252 chars 'Ã' (C3) + soft hyphen (AD):
    // the child converts them back to the bytes C3 AD, i.e. valid UTF-8.
    expect(encodeAnsiArgvText('concluída', 1252)).toBe('concluÃ­da');
    // 'Á' U+00C1 → C3 81; 81 has no cp1252 glyph but Windows round-trips it
    // to the C1 control char U+0081.
    expect(encodeAnsiArgvText('Água', 1252)).toBe('Ãgua');
    // '€' U+20AC → E2 82 AC; 0x82 maps to U+201A in cp1252.
    expect(encodeAnsiArgvText('€', 1252)).toBe('â‚¬');
  });

  it('strips accents on any other codepage instead of speaking garbage', () => {
    expect(encodeAnsiArgvText('missão concluída', 932)).toBe('missao concluida');
  });
});

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
  it('parses hwnd/pid/exe/title TSV lines', () => {
    const stdout = '132456\t4242\tWindowsTerminal\tclaude-manager — claude\n789\t77\twarp\tWarp\n';
    expect(parseWindowList(stdout)).toEqual([
      { id: '132456', pid: 4242, class: 'windowsterminal', title: 'claude-manager — claude' },
      { id: '789', pid: 77, class: 'warp', title: 'Warp' },
    ]);
  });
  it('skips malformed lines', () => {
    expect(parseWindowList('garbage\n\n42\t7\texe\ttitle\n')).toEqual([
      { id: '42', pid: 7, class: 'exe', title: 'title' },
    ]);
  });
});

describe('listWindows', () => {
  it('runs powershell and parses the output', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '7\t99\tWindowsTerminal\thello\n' });
    const windows = await listWindows({ execFn });
    expect(execFn).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      expect.stringContaining('EnumWindows'),
    ]);
    expect(windows).toEqual([{ id: '7', pid: 99, class: 'windowsterminal', title: 'hello' }]);
  });
  it('returns [] when powershell fails', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('nope'));
    expect(await listWindows({ execFn })).toEqual([]);
  });
});

describe('process ancestors', () => {
  it('parseProcessAncestors reads one pid per line', () => {
    expect(parseProcessAncestors('4242\r\n300\r\n7\r\n')).toEqual([4242, 300, 7]);
  });
  it('parseProcessAncestors skips non-numeric lines', () => {
    expect(parseProcessAncestors('oops\n42\n\n')).toEqual([42]);
  });
  it('processAncestorsScript only accepts a numeric pid', () => {
    expect(processAncestorsScript(4242)).toContain('4242');
    expect(() => processAncestorsScript('42; rm x')).toThrow();
  });
  it('listProcessAncestors runs powershell and parses the chain', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '4242\n300\n7\n' });
    expect(await listProcessAncestors(4242, { execFn })).toEqual([4242, 300, 7]);
  });
  it('listProcessAncestors returns [] when powershell fails', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('nope'));
    expect(await listProcessAncestors(4242, { execFn })).toEqual([]);
  });
});

describe('getForegroundWindow', () => {
  it('asks user32 which window is in front', () => {
    expect(foregroundWindowScript()).toContain('GetForegroundWindow');
  });
  it('returns the hwnd as a string', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '1115836\r\n' });
    expect(await getForegroundWindow({ execFn })).toBe('1115836');
  });
  it('returns null when powershell fails', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('nope'));
    expect(await getForegroundWindow({ execFn })).toBeNull();
  });
});

describe('reading the tab titles in one pass', () => {
  it('builds a script that jumps by index and guards the foreground', () => {
    const script = tabTitlesScript('1115836', { maxTabs: 4, jumpKey: '^{n}' });
    expect(script).toContain('1115836');
    expect(script).toContain('GetForegroundWindow');
    expect(script).toContain('^1');
    expect(script).toContain('^4');
  });

  it('rejects a non-numeric hwnd', () => {
    expect(() => tabTitlesScript('12; rm x', { maxTabs: 2, jumpKey: '^{n}' })).toThrow();
  });

  it('parses index/title pairs', () => {
    expect(parseTabTitles('1\tprimeira\r\n2\tsegunda\r\n')).toEqual([
      { index: 1, title: 'primeira' },
      { index: 2, title: 'segunda' },
    ]);
  });

  it('drops the ABORT marker the script emits when focus was lost', () => {
    expect(parseTabTitles('1\tprimeira\nABORT\n')).toEqual([{ index: 1, title: 'primeira' }]);
  });

  it('readTabTitles returns [] when powershell fails', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('nope'));
    expect(await readTabTitles('123', { execFn, jumpKey: '^{n}' })).toEqual([]);
  });

  it('never builds a jump past index 9 — SendKeys reads ^10 as Ctrl+1 then "0"', () => {
    const script = tabTitlesScript('1115836', { maxTabs: 12, jumpKey: '^{n}' });
    expect(script).toContain('^9');
    expect(script).not.toContain('^10');
  });

  it('flags a walk that was cut short by losing the foreground', () => {
    expect(parseTabTitles('1\tprimeira\nABORT\n')).toEqual([{ index: 1, title: 'primeira' }]);
    expect(walkWasAborted('1\tprimeira\nABORT\n')).toBe(true);
    expect(walkWasAborted('1\tprimeira\n2\tsegunda\n')).toBe(false);
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
