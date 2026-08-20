import { describe, expect, it } from 'vitest';
import {
  automationOutcomeFromError,
  probeSystemEventsAutomation,
  accessibilityLostAfterUpdate,
  resetAccessibilityEntries,
  readGrantMemory,
  writeGrantMemory,
  ACCESSIBILITY_PANE,
  AUTOMATION_PANE,
} from '../src/main/permissions-darwin.js';

describe('automationOutcomeFromError', () => {
  it('classifies the AppleEvents consent errors', () => {
    expect(automationOutcomeFromError({ stderr: 'execution error: Not authorized (-1743)' })).toBe(
      'denied',
    );
    expect(automationOutcomeFromError({ message: 'osascript failed (-1744)' })).toBe('pending');
    expect(automationOutcomeFromError({ stderr: 'some other failure' })).toBe('unknown');
    expect(automationOutcomeFromError(null)).toBe('unknown');
  });
});

describe('probeSystemEventsAutomation', () => {
  it('reports granted when the probe event goes through', async () => {
    const execFn = async () => ({ stdout: '42\n' });
    expect(await probeSystemEventsAutomation({ execFn })).toBe('granted');
  });

  it('reports denied when the user refused automation', async () => {
    const execFn = async () => {
      const error = new Error('osascript');
      error.stderr = 'System Events got an error (-1743)';
      throw error;
    };
    expect(await probeSystemEventsAutomation({ execFn })).toBe('denied');
  });
});

describe('accessibilityLostAfterUpdate', () => {
  it('fires only when a remembered grant is gone', () => {
    expect(accessibilityLostAfterUpdate({ accessible: true }, false)).toBe(true);
    expect(accessibilityLostAfterUpdate({ accessible: true }, true)).toBe(false);
    // never granted (or first boot): nothing was lost
    expect(accessibilityLostAfterUpdate({ accessible: false }, false)).toBe(false);
    expect(accessibilityLostAfterUpdate(null, false)).toBe(false);
  });
});

describe('resetAccessibilityEntries', () => {
  it('resets the bundle id through tccutil', async () => {
    const calls = [];
    const execFn = async (command, args) => {
      calls.push({ command, args });
      return { stdout: '' };
    };
    expect(await resetAccessibilityEntries('io.github.example.app', { execFn })).toBe(true);
    expect(calls[0]).toEqual({
      command: 'tccutil',
      args: ['reset', 'Accessibility', 'io.github.example.app'],
    });
  });

  it('refuses a bundle id that is not one, and survives tccutil failing', async () => {
    const calls = [];
    const execFn = async (...args) => {
      calls.push(args);
      throw new Error('refused');
    };
    expect(await resetAccessibilityEntries('bad id; rm -rf /', { execFn })).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await resetAccessibilityEntries('io.ok.app', { execFn })).toBe(false);
  });
});

describe('grant memory', () => {
  it('round-trips through the injected fs and shrugs at garbage', () => {
    let stored = null;
    writeGrantMemory('/x', { accessible: true }, { writeFileSync: (_f, data) => (stored = data) });
    expect(readGrantMemory('/x', { readFileSync: () => stored })).toEqual({ accessible: true });
    expect(
      readGrantMemory('/x', {
        readFileSync: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBeNull();
    expect(() =>
      writeGrantMemory('/x', {}, {
        writeFileSync: () => {
          throw new Error('EROFS');
        },
      }),
    ).not.toThrow();
  });
});

describe('settings panes', () => {
  it('point at the privacy panels', () => {
    expect(ACCESSIBILITY_PANE).toContain('Privacy_Accessibility');
    expect(AUTOMATION_PANE).toContain('Privacy_Automation');
  });
});
