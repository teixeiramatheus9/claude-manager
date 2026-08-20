import { describe, expect, it } from 'vitest';
import {
  automationOutcomeFromError,
  probeSystemEventsAutomation,
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

describe('settings panes', () => {
  it('point at the privacy panels', () => {
    expect(ACCESSIBILITY_PANE).toContain('Privacy_Accessibility');
    expect(AUTOMATION_PANE).toContain('Privacy_Automation');
  });
});
