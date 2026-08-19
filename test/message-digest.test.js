import { describe, expect, it } from 'vitest';
import { digestMessage } from '../src/main/message-digest.js';

describe('digestMessage', () => {
  it('keeps a short message as it is', () => {
    expect(digestMessage('Rodei a suíte: 192 testes passando.')).toBe(
      'Rodei a suíte: 192 testes passando.',
    );
  });

  it('collapses the line breaks a transcript message is full of', () => {
    expect(digestMessage('Primeira linha.\n\n  Segunda linha.\t Terceira.')).toBe(
      'Primeira linha. Segunda linha. Terceira.',
    );
  });

  it('cuts on a word boundary and marks the cut', () => {
    const digest = digestMessage('palavra '.repeat(60), 40);
    expect(digest.length).toBeLessThanOrEqual(41);
    expect(digest.endsWith('…')).toBe(true);
    expect(digest).not.toMatch(/palav…$/);
  });

  it('still cuts when a single word is longer than the limit', () => {
    expect(digestMessage('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`);
  });

  it('has nothing to show for an empty or missing message', () => {
    expect(digestMessage('')).toBe(null);
    expect(digestMessage('   \n  ')).toBe(null);
    expect(digestMessage(null)).toBe(null);
    expect(digestMessage(undefined)).toBe(null);
  });
});
