import { runClaude } from './claude-cli.js';

export const FALLBACK_PHRASES = [
  (projectName) => `Opa, aquela tarefa do '${projectName}' já terminou, dá uma olhada lá po!`,
  (projectName) => `E aí, o chat '${projectName}' acabou o serviço. Confere lá!`,
  (projectName) => `Terminou! O '${projectName}' tá esperando teu veredito.`,
  (projectName) => `Missão cumprida no '${projectName}'. Vai lá ver como ficou!`,
];

export const WAITING_PHRASES = [
  'Dá uma olhada aqui e me fala como seguir!',
  'Esperando você dizer como continua.',
  'Me fala aí como ficou essa task!',
  'Preciso de você aqui rapidinho!',
];

// A permission ask is the red-alert flavor of Notification — detected on the
// RAW message, because humanizeNotification rewrites it right after.
export function isPermissionAsk(message) {
  return /permission to use/i.test(String(message ?? ''));
}

// Claude Code notifications arrive in English ("Claude is waiting for your
// input", "Claude needs your permission to use Bash") — turn them into the
// manager's casual pt-BR voice.
export function humanizeNotification(message, random = Math.random) {
  const original = String(message ?? '');
  const permissionMatch = original.match(/permission to use (\S+)/i);
  if (permissionMatch) {
    const tool = permissionMatch[1].replace(/[.,;:!?]+$/, '');
    return `Quer tua permissão pra usar ${tool} — libera aí?`;
  }
  return WAITING_PHRASES[Math.floor(random() * WAITING_PHRASES.length)];
}

// No title here on purpose. This is what comes out when claude -p fails or
// economy mode is on, and a generic "Tarefa concluída" would overwrite the
// chat's subject with something the status dot and label already say.
export function fallbackMessage(projectName, random = Math.random) {
  const phrase = FALLBACK_PHRASES[Math.floor(random() * FALLBACK_PHRASES.length)];
  return { message: phrase(projectName) };
}

export function buildPrompt(projectName, lastAssistantMessage) {
  const context = lastAssistantMessage
    ? `Última resposta do assistente nessa sessão (pode estar truncada):\n"""\n${lastAssistantMessage}\n"""`
    : 'Não há transcript disponível — seja genérico.';
  return [
    'Você é o "gerente" descontraído das sessões do Claude Code do usuário.',
    `Uma sessão do projeto '${projectName}' acabou de terminar uma tarefa.`,
    context,
    'Responda SOMENTE com JSON válido neste formato: {"title": "...", "message": "..."}',
    '- "title": máximo 6 palavras, em pt-BR, nomeando o ASSUNTO do chat (do que',
    '  essa conversa trata como um todo), não o que acabou de ser feito agora.',
    `- "message": 1 a 2 frases em pt-BR bem informal, estilo "Opa, aquela tarefa do '${projectName}' terminou, dá uma olhada lá po", mencionando brevemente o que foi feito.`,
    'Nada de markdown, nada de texto fora do JSON.',
  ].join('\n');
}

export function parseVoiceResponse(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    if (typeof parsed.title === 'string' && typeof parsed.message === 'string') {
      return { title: parsed.title.trim(), message: parsed.message.trim() };
    }
  } catch {
    // fall through to null
  }
  return null;
}

export async function generateManagerMessage({
  projectName,
  lastAssistantMessage,
  timeoutMs = 15000,
  spawnFn,
}) {
  const result = await runClaude({
    prompt: buildPrompt(projectName, lastAssistantMessage),
    timeoutMs,
    ...(spawnFn ? { spawnFn } : {}),
  });
  // tokens count even when the reply fails to parse — they were spent.
  const tokensUsed = result?.tokens ?? 0;
  const parsed = result ? parseVoiceResponse(result.text) : null;
  return { ...(parsed ?? fallbackMessage(projectName)), tokensUsed };
}
