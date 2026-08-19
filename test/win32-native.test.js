import { describe, it, expect, vi } from 'vitest';
import {
  psQuote,
  escapeSendKeys,
  parseWindowList,
  listWindows,
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
