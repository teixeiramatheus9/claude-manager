import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseLastAssistantMessage,
  parsePendingQuestion,
  parseAiTitle,
  readTranscriptSnapshot,
  readLastAssistantMessage,
  readAiTitle,
} from '../src/main/transcript.js';

const assistantLine = (text) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const userLine = (text) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

describe('parseLastAssistantMessage', () => {
  it('returns the text of the LAST assistant entry', () => {
    const jsonl = [assistantLine('first'), userLine('question'), assistantLine('last answer')].join('\n');
    expect(parseLastAssistantMessage(jsonl)).toBe('last answer');
  });

  it('joins multiple text blocks and skips non-text blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'part one' },
          { type: 'tool_use', name: 'Bash', input: {} },
          { type: 'text', text: 'part two' },
        ],
      },
    });
    expect(parseLastAssistantMessage(line)).toBe('part one\npart two');
  });

  it('skips malformed lines and assistant entries without text', () => {
    const toolOnly = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
    });
    const jsonl = [assistantLine('real text'), 'not json {{{', toolOnly].join('\n');
    expect(parseLastAssistantMessage(jsonl)).toBe('real text');
  });

  it('returns null when there is no assistant text', () => {
    expect(parseLastAssistantMessage(userLine('hi'))).toBeNull();
    expect(parseLastAssistantMessage('')).toBeNull();
  });

  it('truncates long messages to 1500 chars plus ellipsis', () => {
    const result = parseLastAssistantMessage(assistantLine('x'.repeat(3000)));
    expect(result).toHaveLength(1501);
    expect(result.endsWith('…')).toBe(true);
  });
});

const askLine = () =>
  JSON.stringify({
    parentUuid: 'x',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'AskUserQuestion',
          input: {
            questions: [
              {
                question: 'Qual branch você quer?',
                header: 'Branch',
                options: [
                  { label: 'feat/sdv-nova', description: 'a mais recente' },
                  { label: 'feat/sdv-antiga', description: 'a estável' },
                ],
              },
            ],
          },
        },
      ],
    },
  });

describe('parsePendingQuestion', () => {
  it('extracts question and option labels from a trailing AskUserQuestion', () => {
    const jsonl = [userLine('faz ai'), assistantLine('vou perguntar'), askLine()].join('\n');
    expect(parsePendingQuestion(jsonl)).toEqual({
      questions: [
        {
          question: 'Qual branch você quer?',
          multiSelect: false,
          options: ['feat/sdv-nova', 'feat/sdv-antiga'],
        },
      ],
    });
  });

  it('returns null when the user already answered (user entry after the ask)', () => {
    const jsonl = [askLine(), userLine('a primeira')].join('\n');
    expect(parsePendingQuestion(jsonl)).toBeNull();
  });

  it('returns null when there is no pending ask', () => {
    expect(parsePendingQuestion([userLine('oi'), assistantLine('salve')].join('\n'))).toBeNull();
    expect(parsePendingQuestion('')).toBeNull();
  });
});

const aiTitleLine = (title) => JSON.stringify({ type: 'ai-title', aiTitle: title });

describe('parseAiTitle', () => {
  it('returns the LAST ai-title entry', () => {
    const jsonl = [
      aiTitleLine('primeiro tema'),
      assistantLine('respondi'),
      aiTitleLine('tema atualizado'),
      assistantLine('respondi de novo'),
    ].join('\n');
    expect(parseAiTitle(jsonl)).toBe('tema atualizado');
  });

  it('skips malformed lines and entries without a string aiTitle', () => {
    const jsonl = [
      aiTitleLine('tema real'),
      'not json {{{',
      JSON.stringify({ type: 'ai-title', aiTitle: 42 }),
      JSON.stringify({ type: 'ai-title' }),
    ].join('\n');
    expect(parseAiTitle(jsonl)).toBe('tema real');
  });

  it('ignores blank titles', () => {
    expect(parseAiTitle(aiTitleLine('   '))).toBeNull();
  });

  it('returns null when there is no ai-title', () => {
    expect(parseAiTitle([userLine('oi'), assistantLine('salve')].join('\n'))).toBeNull();
    expect(parseAiTitle('')).toBeNull();
  });
});

describe('readAiTitle', () => {
  it('reads the title from a real file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-ai-title-'));
    const file = path.join(dir, 't.jsonl');
    await writeFile(file, `${aiTitleLine('Windows update check não funciona')}\n${assistantLine('oi')}\n`);
    expect(await readAiTitle(file)).toBe('Windows update check não funciona');
  });

  it('returns null for a missing file', async () => {
    expect(await readAiTitle('/nonexistent/nope.jsonl')).toBeNull();
  });
});

describe('readTranscriptSnapshot', () => {
  it('returns last assistant message and pending question from a file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-snapshot-'));
    const file = path.join(dir, 't.jsonl');
    await writeFile(file, `${assistantLine('trabalhei muito')}\n${askLine()}\n`);
    const snapshot = await readTranscriptSnapshot(file);
    expect(snapshot.lastAssistantMessage).toBe('trabalhei muito');
    expect(snapshot.pendingQuestion.questions[0].options).toHaveLength(2);
  });

  it('returns empty snapshot for a missing file', async () => {
    expect(await readTranscriptSnapshot('/nonexistent/nope.jsonl')).toEqual({
      lastAssistantMessage: null,
      pendingQuestion: null,
    });
  });
});

describe('readLastAssistantMessage', () => {
  it('reads from a real file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-transcript-'));
    const file = path.join(dir, 't.jsonl');
    await writeFile(file, `${assistantLine('from disk')}\n`);
    expect(await readLastAssistantMessage(file)).toBe('from disk');
  });

  it('returns null for a missing file', async () => {
    expect(await readLastAssistantMessage('/nonexistent/nope.jsonl')).toBeNull();
  });
});
