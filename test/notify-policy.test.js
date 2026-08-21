import { describe, it, expect } from 'vitest';
import { shouldAnnounce, REANNOUNCE_MS } from '../src/main/notify-policy.js';

describe('shouldAnnounce', () => {
  it('stays silent when the chat terminal is the focused window', () => {
    expect(
      shouldAnnounce({ kind: 'done', text: 'acabou', focused: true }),
    ).toEqual({ announce: false, reason: 'focused' });
  });

  it('silences even pending questions when the user is already looking', () => {
    expect(shouldAnnounce({ kind: 'question', text: 'qual?', focused: true }).announce).toBe(false);
  });

  it('announces normally when the chat is in another window', () => {
    expect(shouldAnnounce({ kind: 'done', text: 'acabou', focused: false }).announce).toBe(true);
  });

  // Claude Code fires a Notification ~60s after the Stop for the same state;
  // same text within the window is the same news — one bark only.
  it('suppresses the waiting repeat of a fresh announcement with the same text', () => {
    const lastAnnouncement = { text: 'acabou', at: 1000 };
    expect(
      shouldAnnounce({ kind: 'waiting', text: 'acabou', focused: false, lastAnnouncement, now: 61_000 }),
    ).toEqual({ announce: false, reason: 'repeat' });
  });

  it('re-announces the waiting state after the cooldown if the user never showed up', () => {
    const lastAnnouncement = { text: 'acabou', at: 1000 };
    expect(
      shouldAnnounce({
        kind: 'waiting',
        text: 'acabou',
        focused: false,
        lastAnnouncement,
        now: 1000 + REANNOUNCE_MS + 1,
      }).announce,
    ).toBe(true);
  });

  it('announces a waiting with NEW text right away', () => {
    const lastAnnouncement = { text: 'acabou', at: 1000 };
    expect(
      shouldAnnounce({ kind: 'waiting', text: 'pergunta nova', focused: false, lastAnnouncement, now: 2000 })
        .announce,
    ).toBe(true);
  });

  it('announces on unknown focus by default (when in doubt, bark)', () => {
    expect(shouldAnnounce({ kind: 'done', text: 't', focused: null }).announce).toBe(true);
  });

  it('respects the user choice to stay quiet on unknown focus', () => {
    expect(
      shouldAnnounce({ kind: 'done', text: 't', focused: null, announceWhenUnknown: false }),
    ).toEqual({ announce: false, reason: 'unknown-muted' });
  });

  it('the unknown-focus choice never mutes a chat known to be elsewhere', () => {
    expect(
      shouldAnnounce({ kind: 'done', text: 't', focused: false, announceWhenUnknown: false }).announce,
    ).toBe(true);
  });
});
