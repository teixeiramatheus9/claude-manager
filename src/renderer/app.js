const badge = document.getElementById('badge');
const core = document.getElementById('core');
const tooltip = document.getElementById('tooltip');
const tooltipProject = document.getElementById('tooltip-project');
const tooltipText = document.getElementById('tooltip-text');
const panel = document.getElementById('panel');
const sessionsContainer = document.getElementById('sessions');

const bubble = document.getElementById('bubble');

const TOOLTIP_HIDE_MS = 8000;
let panelOpen = false;
let tooltipTimer = null;
// managed = X11 session: main process handles drag/click detection on the
// bubble; false = Wayland, where the compositor drags via app-region CSS.
let managed = false;

const STATUS_LABEL = {
  working: 'trabalhando…',
  done: 'terminou',
  waiting: 'esperando você',
};

function applyMode() {
  if (panelOpen) {
    window.manager.setMode('panel');
    tooltip.style.display = 'none';
    panel.style.display = 'flex';
  } else if (tooltip.style.display === 'block') {
    window.manager.setMode('tooltip');
    panel.style.display = 'none';
  } else {
    window.manager.setMode('bubble');
    panel.style.display = 'none';
  }
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  tooltip.style.display = 'none';
  applyMode();
}

function openPanel() {
  panelOpen = true;
  clearTimeout(tooltipTimer);
  tooltip.style.display = 'none';
  applyMode();
  window.manager.panelOpened();
}

function closePanel() {
  panelOpen = false;
  applyMode();
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

// Wayland: only the small no-drag core/badge receive DOM clicks.
// Managed/X11: the whole bubble is press-to-drag, and main reports back a
// 'ui:click' when the press didn't move — so DOM clicks are ignored there
// to avoid double toggling.
core.addEventListener('click', () => {
  if (!managed) togglePanel();
});
badge.addEventListener('click', () => {
  if (!managed) togglePanel();
});
tooltip.addEventListener('click', openPanel);
document.getElementById('close').addEventListener('click', closePanel);

bubble.addEventListener('mousedown', (event) => {
  if (managed && event.button === 0) window.manager.dragStart();
});
window.addEventListener('mouseup', () => {
  if (managed) window.manager.dragEnd();
});

window.manager.onEnv((env) => {
  managed = env.managed;
  document.body.classList.toggle('managed', managed);
});

window.manager.onClick(togglePanel);

window.manager.onFlip((flipped) => {
  document.body.classList.toggle('flip', flipped);
});

// --- Notification chimes (synthesized: soft, short, no alarm vibes) ---
const muteButton = document.getElementById('mute');
let muted = localStorage.getItem('muted') === '1';
let audioContext = null;

const SVG_ATTRS =
  'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const BELL_SVG = `<svg ${SVG_ATTRS}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const BELL_OFF_SVG = `<svg ${SVG_ATTRS}><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const SEND_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

const SPARK_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5l1.9 7.1 7.1 1.9-7.1 1.9-1.9 7.1-1.9-7.1-7.1-1.9 7.1-1.9z"/></svg>`;
const FOLDER_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const HELP_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97757" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

// Sets "<icon> <text>" on an element without letting the text act as HTML.
function iconLabel(element, svgMarkup, text) {
  element.innerHTML = svgMarkup;
  element.append(document.createTextNode(` ${text}`));
}

function renderMuteButton() {
  muteButton.innerHTML = muted ? BELL_OFF_SVG : BELL_SVG;
}
renderMuteButton();

muteButton.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('muted', muted ? '1' : '0');
  renderMuteButton();
  if (!muted) chime('done');
});

// --- manager chat view ---
const chatToggle = document.getElementById('chat-toggle');
const chatView = document.getElementById('chat');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
let chatOpen = false;

function appendChatBubble(role, text, pending = false) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}${pending ? ' pending' : ''}`;
  bubble.textContent = text;
  chatMessages.append(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function renderChatEmptyState() {
  if (chatMessages.childElementCount) return;
  const empty = document.createElement('div');
  empty.id = 'chat-empty';
  empty.textContent =
    'Pergunta qualquer coisa sobre teus chats: "resume o dia", "como tá o projeto-alpha?", "quem tá travado?"';
  chatMessages.append(empty);
}

function setChatOpen(open) {
  chatOpen = open;
  chatView.classList.toggle('hidden', !open);
  sessionsContainer.classList.toggle('hidden', open);
  settingsPop.classList.add('hidden');
  if (open) {
    renderChatEmptyState();
    chatInput.focus();
  }
}

chatToggle.addEventListener('click', () => setChatOpen(!chatOpen));

async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || chatSend.disabled) return;
  document.getElementById('chat-empty')?.remove();
  chatInput.value = '';
  appendChatBubble('user', text);
  const pendingBubble = appendChatBubble('manager', 'digitando…', true);
  chatSend.disabled = true;
  try {
    const reply = await window.manager.chatWithManager(text);
    pendingBubble.classList.remove('pending');
    pendingBubble.textContent = reply || '…';
  } catch {
    pendingBubble.textContent = 'Deu ruim aqui 😅 tenta de novo';
  } finally {
    chatSend.disabled = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    chatInput.focus();
  }
}

chatSend.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Enter') sendChatMessage();
});

// --- sound settings (volume + timbre presets, persisted locally) ---
const CHIME_PRESETS = {
  marimba: {
    start: [[440, 0, 0.05]],
    done: [
      [659.25, 0, 0.09],
      [987.77, 0.13, 0.075],
    ],
    question: [
      [587.33, 0, 0.075],
      [783.99, 0.16, 0.065],
    ],
    waiting: [
      [523.25, 0, 0.07],
      [523.25, 0.18, 0.055],
    ],
  },
  cristal: {
    start: [[659.25, 0, 0.04]],
    done: [
      [880, 0, 0.07],
      [1318.51, 0.11, 0.06],
    ],
    question: [
      [987.77, 0, 0.06],
      [1174.66, 0.14, 0.05],
    ],
    waiting: [
      [783.99, 0, 0.055],
      [987.77, 0.15, 0.045],
    ],
  },
  grave: {
    start: [[220, 0, 0.06]],
    done: [
      [329.63, 0, 0.1],
      [493.88, 0.15, 0.085],
    ],
    question: [
      [293.66, 0, 0.085],
      [392, 0.17, 0.07],
    ],
    waiting: [
      [261.63, 0, 0.08],
      [261.63, 0.2, 0.06],
    ],
  },
};

const DEFAULT_TYPE_VOLUMES = { start: 60, done: 100, question: 100, waiting: 100 };

let soundVolume = Number(localStorage.getItem('soundVolume') ?? 70);
let soundTimbre = localStorage.getItem('soundTimbre') ?? 'marimba';
if (!CHIME_PRESETS[soundTimbre]) soundTimbre = 'marimba';
let typeVolumes = { ...DEFAULT_TYPE_VOLUMES };
try {
  typeVolumes = { ...DEFAULT_TYPE_VOLUMES, ...JSON.parse(localStorage.getItem('soundTypeVolumes')) };
} catch {
  // defaults stay
}
let ttsEnabled = localStorage.getItem('ttsEnabled') === '1';

const settingsButton = document.getElementById('settings');
const settingsPop = document.getElementById('settings-pop');
const volumeInput = document.getElementById('volume');
const timbreSelect = document.getElementById('timbre');
volumeInput.value = String(soundVolume);
timbreSelect.value = soundTimbre;

settingsButton.addEventListener('click', () => settingsPop.classList.toggle('hidden'));
volumeInput.addEventListener('input', () => {
  soundVolume = Number(volumeInput.value);
  localStorage.setItem('soundVolume', String(soundVolume));
});
timbreSelect.addEventListener('change', () => {
  soundTimbre = timbreSelect.value;
  localStorage.setItem('soundTimbre', soundTimbre);
});
document.getElementById('sound-test').addEventListener('click', () => chime('done', true));

for (const slider of document.querySelectorAll('.type-row input[type="range"]')) {
  const kind = slider.dataset.kind;
  slider.value = String(typeVolumes[kind] ?? 100);
  slider.addEventListener('input', () => {
    typeVolumes[kind] = Number(slider.value);
    localStorage.setItem('soundTypeVolumes', JSON.stringify(typeVolumes));
  });
  slider.addEventListener('change', () => chime(kind, true));
}

const ttsCheckbox = document.getElementById('tts');
ttsCheckbox.checked = ttsEnabled;
ttsCheckbox.addEventListener('change', () => {
  ttsEnabled = ttsCheckbox.checked;
  localStorage.setItem('ttsEnabled', ttsEnabled ? '1' : '0');
  if (ttsEnabled) window.manager.speak('Notificação por voz ativada.');
});

// --- manager config (terminal + daily token budget) ---
const terminalSelect = document.getElementById('terminal');
const voiceSelect = document.getElementById('voice');
const budgetInput = document.getElementById('budget');
const budgetLabel = document.getElementById('budget-label');
const usageLine = document.getElementById('usage-line');

const formatTokens = (value) =>
  value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k` : String(value);

function renderBudgetLabel(value) {
  budgetLabel.textContent = value <= 0 ? 'economia total' : formatTokens(value);
}

window.manager.getConfig().then((config) => {
  if (Array.isArray(config.terminals) && config.terminals.length) {
    terminalSelect.replaceChildren(
      ...config.terminals.map(({ value, label }) => new Option(label, value)),
    );
  }
  terminalSelect.value = config.terminal;
  if (Array.isArray(config.voices) && config.voices.length) {
    voiceSelect.replaceChildren(
      ...config.voices.map(({ value, label }) => new Option(label, value)),
    );
  }
  voiceSelect.value = config.voice;
  budgetInput.value = String(config.tokenBudgetDaily);
  renderBudgetLabel(config.tokenBudgetDaily);
});

terminalSelect.addEventListener('change', () => {
  window.manager.setConfig({ terminal: terminalSelect.value });
});

voiceSelect.addEventListener('change', () => {
  window.manager.setConfig({ voice: voiceSelect.value });
});

budgetInput.addEventListener('input', () => renderBudgetLabel(Number(budgetInput.value)));
budgetInput.addEventListener('change', () => {
  window.manager.setConfig({ tokenBudgetDaily: Number(budgetInput.value) });
});

function renderUsage(tokens) {
  if (!tokens) return;
  usageLine.replaceChildren();
  const text = document.createElement('span');
  text.textContent =
    tokens.budget <= 0
      ? 'IA desligada por escolha sua — só frases prontas.'
      : `hoje: ${formatTokens(tokens.usedToday)} / ${formatTokens(tokens.budget)} tokens`;
  usageLine.append(text);
  if (tokens.economy) {
    const badge = document.createElement('span');
    badge.className = 'eco-badge';
    badge.textContent = 'ECO';
    usageLine.append(badge);
  }
}

function playNote(frequency, startOffset, peakGain) {
  const now = audioContext.currentTime + startOffset;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.55);
}

function chime(kind, force = false) {
  if (muted && !force) return;
  try {
    audioContext ??= new AudioContext();
    const preset = CHIME_PRESETS[soundTimbre] ?? CHIME_PRESETS.marimba;
    const notes = preset[kind] ?? preset.done;
    const typeFactor = (typeVolumes[kind] ?? 100) / 100;
    const volumeFactor = (soundVolume / 70) * typeFactor; // 70 = original calibration
    if (volumeFactor <= 0) return;
    for (const [frequency, startOffset, peakGain] of notes) {
      playNote(frequency, startOffset, peakGain * volumeFactor);
    }
  } catch {
    // audio not available; stay silent
  }
}

window.manager.onBlur(() => {
  if (panelOpen) closePanel();
});

window.manager.onChime(({ kind }) => chime(kind));

// Spoken notifications stay short and instantly understandable — the full
// message lives in the tooltip/panel.
const TTS_PHRASES = {
  done: (projectName) => `Tarefa concluída no ${projectName}.`,
  question: (projectName) => `Pergunta pendente no ${projectName}.`,
  waiting: (projectName) => `O chat ${projectName} espera você.`,
};

window.manager.onTooltip(({ projectName, text, kind }) => {
  chime(kind);
  if (ttsEnabled && !muted) {
    const phrase = TTS_PHRASES[kind] ?? TTS_PHRASES.waiting;
    window.manager.speak(phrase(projectName));
  }
  if (panelOpen) return;
  iconLabel(tooltipProject, SPARK_SVG, projectName);
  tooltipText.textContent = text;
  tooltip.style.display = 'block';
  applyMode();
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideTooltip, TOOLTIP_HIDE_MS);
});

function relativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'agora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

// Reply drafts survive re-renders (every state change rebuilds the list).
const replyDrafts = new Map();
const replyFeedback = new Map();
let focusedReplySessionId = null;

function replyElement(session) {
  const container = document.createElement('div');
  container.className = 'reply';
  const input = document.createElement('input');
  input.placeholder = 'Resposta rápida…';
  input.value = replyDrafts.get(session.id) ?? '';
  const sendButton = document.createElement('button');
  sendButton.innerHTML = SEND_SVG;
  sendButton.title = 'Enviar pro chat no Warp';
  const feedback = document.createElement('div');
  feedback.className = 'reply-feedback';
  feedback.textContent = replyFeedback.get(session.id) ?? '';

  const FEEDBACK_TEXT = {
    typed: 'Enviado pro chat no Warp ✓',
    clipboard: 'Copiado! Cola no chat com Ctrl+V',
    failed: 'Não consegui enviar 😅 tenta de novo',
  };

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendButton.disabled = true;
    const mode = await window.manager.sendReply(session.id, text);
    sendButton.disabled = false;
    replyFeedback.set(session.id, FEEDBACK_TEXT[mode] ?? '');
    feedback.textContent = replyFeedback.get(session.id);
    if (mode === 'typed') {
      replyDrafts.delete(session.id);
      input.value = '';
    }
  }

  input.addEventListener('input', () => replyDrafts.set(session.id, input.value));
  input.addEventListener('focus', () => {
    focusedReplySessionId = session.id;
  });
  input.addEventListener('blur', () => {
    if (focusedReplySessionId === session.id) focusedReplySessionId = null;
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') send();
  });
  for (const element of [container, input, sendButton]) {
    element.addEventListener('click', (event) => event.stopPropagation());
  }
  sendButton.addEventListener('click', send);

  container.append(input, sendButton);
  const wrapper = document.createElement('div');
  wrapper.append(container, feedback);
  wrapper.dataset.sessionId = session.id;
  return { wrapper, input };
}

// Appends the quick-reply UI (when applicable) and returns the finished card.
function finishCard(card, session) {
  if (session.status !== 'working') {
    const { wrapper, input } = replyElement(session);
    card.append(wrapper);
    if (focusedReplySessionId === session.id) {
      queueMicrotask(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }
  return card;
}

function sessionElement(session) {
  const card = document.createElement('div');
  card.className = `session${session.unread ? ' unread' : ''}`;
  card.title = 'Abrir no Warp';
  card.addEventListener('click', () => window.manager.focusSession(session.id));

  const top = document.createElement('div');
  top.className = 'session-top';
  const dot = document.createElement('span');
  dot.className = `dot ${session.status}`;
  const name = document.createElement('span');
  name.className = 'name';
  // "Tema" do chat: título gerado pela IA > primeiro prompt > pasta.
  name.textContent = session.title ?? session.promptPreview ?? session.projectName;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = `${STATUS_LABEL[session.status] ?? session.status} · ${relativeTime(session.updatedAt)}`;
  top.append(dot, name, time);
  card.append(top);

  const project = document.createElement('div');
  project.className = 'title';
  iconLabel(project, FOLDER_SVG, session.projectName);
  card.append(project);

  // One message balloon per chat — the exact text that went out in the
  // tooltip. A pending question adds its options as compact chips INSIDE
  // the same balloon, never as extra message lines.
  const messageText =
    session.managerMessage ?? (session.status === 'done' ? 'Escrevendo o recado…' : null);
  if (messageText) {
    const balloon = document.createElement('div');
    balloon.className = 'message';

    const dismiss = document.createElement('button');
    dismiss.className = 'message-dismiss';
    dismiss.title = 'Dispensar mensagem';
    dismiss.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    dismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      window.manager.dismissMessage(session.id);
    });
    balloon.append(dismiss);
    const text = document.createElement('div');
    if (session.question?.questions?.length) {
      iconLabel(text, HELP_SVG, messageText);
      text.className = 'question-text';
    } else {
      text.textContent = messageText;
    }
    balloon.append(text);

    const firstQuestion = session.question?.questions?.[0];
    if (firstQuestion?.options?.length) {
      // Clickable only when the answer is a simple single choice we can
      // select with arrow keys; multi-select and multi-question go to the chat.
      const clickable = session.question.questions.length === 1 && !firstQuestion.multiSelect;
      const optionsRow = document.createElement('div');
      optionsRow.className = 'options-row';
      firstQuestion.options.forEach((option, optionIndex) => {
        const chip = document.createElement(clickable ? 'button' : 'span');
        chip.className = `option-chip${clickable ? ' clickable' : ''}`;
        chip.textContent = option;
        if (clickable) {
          chip.title = 'Responder com essa opção';
          chip.addEventListener('click', async (event) => {
            event.stopPropagation();
            chip.disabled = true;
            const result = await window.manager.answerQuestion(session.id, optionIndex);
            chip.disabled = false;
            if (result !== 'answered') {
              replyFeedback.set(
                session.id,
                result === 'not-found'
                  ? 'Não achei a aba do chat — responde por lá'
                  : 'Não consegui responder 😅 tenta por lá',
              );
              const feedbackElement = card.querySelector('.reply-feedback');
              if (feedbackElement) feedbackElement.textContent = replyFeedback.get(session.id);
            }
          });
        }
        optionsRow.append(chip);
      });
      balloon.append(optionsRow);
      const extraQuestions = (session.question.questions.length ?? 1) - 1;
      const hint = document.createElement('div');
      hint.className = 'question-hint';
      hint.textContent =
        extraQuestions > 0
          ? `+${extraQuestions} pergunta(s) — abrir o chat pra conferir a fundo →`
          : clickable
            ? 'Clica numa opção pra responder, ou abre o chat pra conferir a fundo →'
            : 'Abrir o chat pra conferir as opções a fundo →';
      balloon.append(hint);
    }
    card.append(balloon);
  }

  return finishCard(card, session);
}

let lastUnreadCount = 0;

const updateBanner = document.getElementById('update-banner');
updateBanner.addEventListener('click', () => window.manager.applyUpdate());

function renderUpdateBanner(update) {
  if (!update || (!update.available && !update.ready)) {
    updateBanner.classList.add('hidden');
    return;
  }
  updateBanner.classList.remove('hidden');
  if (update.ready) {
    updateBanner.textContent = `🚀 v${update.ready} pronta — reiniciar agora`;
  } else if (update.mode === 'auto') {
    updateBanner.textContent = `⬇️ baixando v${update.available}…`;
  } else {
    updateBanner.textContent = `🚀 v${update.available} disponível — baixar`;
  }
}

window.manager.onState((state) => {
  renderUpdateBanner(state.update);
  renderUsage(state.tokens);
  badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
  badge.style.display = state.unread > 0 ? 'flex' : 'none';
  if (state.unread > lastUnreadCount) {
    badge.classList.remove('pop');
    void badge.offsetWidth; // restart the animation
    badge.classList.add('pop');
  }
  lastUnreadCount = state.unread;

  sessionsContainer.replaceChildren();
  if (!state.sessions.length) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'Nenhuma sessão por enquanto. Manda o Claude trabalhar que eu te aviso!';
    sessionsContainer.append(empty);
    return;
  }
  for (const session of state.sessions) {
    sessionsContainer.append(sessionElement(session));
  }
});
