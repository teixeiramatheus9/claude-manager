import { open, stat } from 'node:fs/promises';

const TAIL_BYTES = 256 * 1024;
const MAX_MESSAGE_CHARS = 1500;

export function parseLastAssistantMessage(jsonlText) {
  const lines = jsonlText.split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!text) continue;
    return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
  }
  return null;
}

function isAssistantEntry(entry) {
  return entry?.type === 'assistant' || entry?.message?.role === 'assistant';
}

function isUserEntry(entry) {
  return entry?.type === 'user' || entry?.message?.role === 'user';
}

// A question is "pending" when an AskUserQuestion tool call appears after the
// last user entry — i.e. Claude asked and nobody answered yet.
export function parsePendingQuestion(jsonlText) {
  const lines = jsonlText.split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isUserEntry(entry)) return null;
    if (!isAssistantEntry(entry)) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const ask = content.find(
      (block) => block?.type === 'tool_use' && block.name === 'AskUserQuestion',
    );
    if (!ask?.input?.questions?.length) continue;
    return {
      questions: ask.input.questions.map((item) => ({
        question: String(item.question ?? ''),
        multiSelect: item.multiSelect === true,
        options: (item.options ?? []).map((option) => String(option.label ?? '')).filter(Boolean),
      })),
    };
  }
  return null;
}

async function readTail(transcriptPath) {
  const { size } = await stat(transcriptPath);
  const start = Math.max(0, size - TAIL_BYTES);
  const handle = await open(transcriptPath, 'r');
  try {
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    await handle.close();
  }
}

export async function readTranscriptSnapshot(transcriptPath) {
  try {
    const text = await readTail(transcriptPath);
    return {
      lastAssistantMessage: parseLastAssistantMessage(text),
      pendingQuestion: parsePendingQuestion(text),
    };
  } catch {
    return { lastAssistantMessage: null, pendingQuestion: null };
  }
}

export async function readLastAssistantMessage(transcriptPath) {
  const snapshot = await readTranscriptSnapshot(transcriptPath);
  return snapshot.lastAssistantMessage;
}
