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

// Claude Code titles the chat itself ("ai-title" entries) and pushes that same
// string to the terminal — so it is THE text a tab running the session shows.
export function parseAiTitle(jsonlText) {
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
    if (entry?.type !== 'ai-title' || typeof entry.aiTitle !== 'string') continue;
    const title = entry.aiTitle.trim();
    if (title) return title;
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

// The conversation as the user had it: their prompts and the assistant's
// prose, nothing else. Tool traffic, sidechains (subagents write into the same
// file), injected meta prompts and compact summaries are all skipped — the
// mirror in the panel shows what the terminal showed.
export function parseConversationTail(jsonlText, { limit = 30, maxChars = 600 } = {}) {
  const messages = [];
  for (const rawLine of jsonlText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.isSidechain === true || entry?.isMeta === true || entry?.isCompactSummary === true) {
      continue;
    }
    const role = entry?.type === 'user' ? 'user' : entry?.type === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const content = entry.message?.content;
    const text = (
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((block) => block?.type === 'text' && typeof block.text === 'string')
              .map((block) => block.text)
              .join('\n')
          : ''
    ).trim();
    if (!text) continue;
    messages.push({
      role,
      text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
      at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
    });
  }
  return messages.slice(-limit);
}

export async function readConversationTail(transcriptPath, options) {
  try {
    return parseConversationTail(await readTail(transcriptPath), options);
  } catch {
    return [];
  }
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

export async function readAiTitle(transcriptPath) {
  try {
    return parseAiTitle(await readTail(transcriptPath));
  } catch {
    return null;
  }
}

export async function readLastAssistantMessage(transcriptPath) {
  const snapshot = await readTranscriptSnapshot(transcriptPath);
  return snapshot.lastAssistantMessage;
}
