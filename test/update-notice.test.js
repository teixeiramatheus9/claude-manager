import { describe, expect, it } from 'vitest';
import { shouldAnnounce } from '../src/main/update-notice.js';

describe('shouldAnnounce', () => {
  it('announces when the app came back on the version that was installed', () => {
    expect(shouldAnnounce({ version: '0.6.0' }, '0.6.0')).toBe(true);
  });

  it('stays quiet when the install did not land', () => {
    expect(shouldAnnounce({ version: '0.6.0' }, '0.5.0')).toBe(false);
  });

  it('stays quiet without a note', () => {
    expect(shouldAnnounce(null, '0.6.0')).toBe(false);
    expect(shouldAnnounce({}, '0.6.0')).toBe(false);
  });
});
