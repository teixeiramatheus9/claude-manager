import { describe, expect, it } from 'vitest';
import { parseConversationTail } from '../src/main/transcript.js';

const line = (entry) => JSON.stringify(entry);

const user = (text, extra = {}) =>
  line({ type: 'user', timestamp: '2026-08-19T19:00:00Z', message: { role: 'user', content: text }, ...extra });

const assistant = (blocks, extra = {}) =>
  line({
    type: 'assistant',
    timestamp: '2026-08-19T19:00:01Z',
    message: { role: 'assistant', content: blocks },
    ...extra,
  });

describe('parseConversationTail', () => {
  it('turns the jsonl into the conversation the user actually had', () => {
    const jsonl = [
      user('conserta o updater'),
      assistant([{ type: 'text', text: 'Consertei — 192 testes passando.' }]),
    ].join('\n');
    expect(parseConversationTail(jsonl)).toEqual([
      { role: 'user', text: 'conserta o updater', at: '2026-08-19T19:00:00Z' },
      { role: 'assistant', text: 'Consertei — 192 testes passando.', at: '2026-08-19T19:00:01Z' },
    ]);
  });

  it('skips everything that is not conversation', () => {
    const jsonl = [
      line({ type: 'ai-title', aiTitle: 'x' }),
      line({ type: 'file-history-snapshot', snapshot: {} }),
      user([{ type: 'tool_result', content: 'saída de tool' }]),
      assistant([{ type: 'tool_use', name: 'Bash', input: {} }]),
      user('só isso conta'),
      'linha inválida{',
    ].join('\n');
    expect(parseConversationTail(jsonl)).toEqual([
      { role: 'user', text: 'só isso conta', at: '2026-08-19T19:00:00Z' },
    ]);
  });

  it('ignores sidechains and meta prompts — they are not this chat', () => {
    const jsonl = [
      user('do subagente', { isSidechain: true }),
      user('injetado', { isMeta: true }),
      assistant([{ type: 'text', text: 'resumo' }], { isCompactSummary: true }),
      user('real'),
    ].join('\n');
    expect(parseConversationTail(jsonl)).toEqual([
      { role: 'user', text: 'real', at: '2026-08-19T19:00:00Z' },
    ]);
  });

  it('reads a user message written as text blocks', () => {
    const jsonl = user([
      { type: 'text', text: 'primeira' },
      { type: 'tool_result', content: 'ignora' },
      { type: 'text', text: 'segunda' },
    ]);
    expect(parseConversationTail(jsonl)).toEqual([
      { role: 'user', text: 'primeira\nsegunda', at: '2026-08-19T19:00:00Z' },
    ]);
  });

  it('keeps only the newest messages and truncates each one', () => {
    const jsonl = Array.from({ length: 40 }, (_, i) => user(`msg ${i} ${'x'.repeat(50)}`)).join('\n');
    const tail = parseConversationTail(jsonl, { limit: 5, maxChars: 20 });
    expect(tail).toHaveLength(5);
    expect(tail[0].text.startsWith('msg 35')).toBe(true);
    expect(tail.every((m) => m.text.length <= 21)).toBe(true);
    expect(tail.at(-1).text.endsWith('…')).toBe(true);
  });

  it('has nothing to show for an empty transcript', () => {
    expect(parseConversationTail('')).toEqual([]);
    expect(parseConversationTail('\n\n')).toEqual([]);
  });
});
