const badge = document.getElementById('badge');
const core = document.getElementById('core');
const tooltip = document.getElementById('tooltip');
const tooltipProject = document.getElementById('tooltip-project');
const tooltipText = document.getElementById('tooltip-text');
const panel = document.getElementById('panel');
const sessionsContainer = document.getElementById('sessions');

const bubble = document.getElementById('bubble');
const headerPath = document.getElementById('header-path');

const PATHS = { sessions: '~/.claude/sessions', chat: '~/.claude/chats', config: '~/.claude/config' };

function renderHeaderPath() {
  const view = chatOpen ? 'chat' : settingsPop.classList.contains('hidden') ? 'sessions' : 'config';
  headerPath.textContent = PATHS[view];
}

// One HTML, two windows: the bubble window never resizes, the overlay window
// carries the panel and the toast and is placed by the main process.
const view = new URLSearchParams(location.search).get('view') ?? 'bubble';
document.body.classList.add(`view-${view}`);
let panelOpen = false;
// managed = X11 session: main process handles drag/click detection on the
// bubble; false = Wayland, where the compositor drags via app-region CSS.
let managed = false;

const STATUS_LABEL = {
  working: 'rodando',
  done: 'concluído',
  waiting: 'esperando você',
  question: 'pergunta',
};

window.manager.onOverlayMode((mode) => {
  panelOpen = mode === 'panel';
  panel.style.display = panelOpen ? 'flex' : 'none';
  tooltip.style.display = mode === 'tooltip' ? 'block' : 'none';
  if (panelOpen) window.manager.panelOpened();
});

function hideTooltip() {
  window.manager.closeOverlay();
}

function openPanel() {
  window.manager.openPanel();
}

function closePanel() {
  window.manager.closeOverlay();
}

function togglePanel() {
  window.manager.togglePanel();
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
document.getElementById('quit').addEventListener('click', () => window.manager.quit());

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

// Both windows get the broadcast; only the bubble's click may toggle.
window.manager.onClick(() => {
  if (view === 'bubble') togglePanel();
});

// --- Notification chimes (synthesized: soft, short, no alarm vibes) ---
const muteButton = document.getElementById('mute');
let muted = localStorage.getItem('muted') === '1';
let audioContext = null;

function renderMuteButton() {
  muteButton.textContent = muted ? '[mudo]' : '[som]';
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
    '# pergunta qualquer coisa sobre teus chats: "resume o dia", "como tá o projeto-alpha?", "quem tá travado?"';
  chatMessages.append(empty);
}

function setChatOpen(open) {
  chatOpen = open;
  chatView.classList.toggle('hidden', !open);
  sessionsContainer.classList.toggle('hidden', open);
  settingsPop.classList.add('hidden');
  if (!open) sessionsContainer.classList.remove('hidden');
  if (open) {
    renderChatEmptyState();
    chatInput.focus();
  }
}

chatToggle.addEventListener('click', () => {
  setChatOpen(!chatOpen);
  renderHeaderPath();
});

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
    pendingBubble.textContent = '# deu ruim aqui — tenta de novo';
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

// One view at a time: the list, the config or the manager chat.
settingsButton.addEventListener('click', () => {
  const opening = settingsPop.classList.contains('hidden');
  if (opening) setChatOpen(false);
  settingsPop.classList.toggle('hidden', !opening);
  sessionsContainer.classList.toggle('hidden', opening);
  renderHeaderPath();
});
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
const ttsState = document.getElementById('tts-state');
ttsCheckbox.checked = ttsEnabled;
const renderTtsState = () => {
  ttsState.textContent = ttsEnabled ? '[on]' : '[off]';
};
renderTtsState();
ttsCheckbox.addEventListener('change', () => {
  ttsEnabled = ttsCheckbox.checked;
  localStorage.setItem('ttsEnabled', ttsEnabled ? '1' : '0');
  renderTtsState();
  if (ttsEnabled) window.manager.speak('Notificação por voz ativada.');
});

document.getElementById('voice-test').addEventListener('click', () => {
  window.manager.speak('Testando a voz do gerente.');
});

// Sliders paint their own fill and print the value beside them.
function renderSlider(slider) {
  const max = Number(slider.max) || 100;
  const percent = Math.round((Number(slider.value) / max) * 100);
  slider.style.setProperty('--pct', `${percent}%`);
  const label = document.querySelector(`.slider-value[data-for="${slider.id}"]`);
  if (label) label.textContent = `${slider.value}%`;
}

for (const slider of document.querySelectorAll('#settings-pop input[type="range"]')) {
  renderSlider(slider);
  slider.addEventListener('input', () => renderSlider(slider));
}

// Native selects are drawn by the OS: they ignore the theme and open over
// the current value. These wrap them in a dropdown of our own — the select
// stays in the DOM as the value holder, so reads and change events work.
const dropdowns = [];

function enhanceSelect(select) {
  const wrapper = select.parentElement;
  const trigger = document.createElement('button');
  trigger.className = 'dd-trigger';
  const menu = document.createElement('div');
  menu.className = 'dd-menu hidden';
  wrapper.append(trigger, menu);

  const close = () => menu.classList.add('hidden');
  const render = () => {
    trigger.textContent = `[${select.selectedOptions[0]?.text ?? ''} ▾]`;
    menu.replaceChildren(
      ...[...select.options].map((option) => {
        const item = document.createElement('button');
        item.className = `dd-option${option.value === select.value ? ' selected' : ''}`;
        item.textContent = option.text;
        item.addEventListener('click', (event) => {
          event.stopPropagation();
          select.value = option.value;
          select.dispatchEvent(new Event('change'));
          render();
          close();
        });
        return item;
      }),
    );
  };

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const opening = menu.classList.contains('hidden');
    for (const other of dropdowns) other.close();
    if (!opening) return;
    const box = trigger.getBoundingClientRect();
    menu.style.left = `${box.left}px`;
    menu.style.top = `${box.bottom + 4}px`;
    menu.classList.remove('hidden');
  });

  dropdowns.push({ render, close });
  render();
}

document.addEventListener('click', () => {
  for (const dropdown of dropdowns) dropdown.close();
});

// The menu is positioned against the viewport, so scrolling would leave it
// floating away from its trigger.
document.getElementById('settings-pop').addEventListener('scroll', () => {
  for (const dropdown of dropdowns) dropdown.close();
});

function refreshDropdowns() {
  for (const dropdown of dropdowns) dropdown.render();
}

// --- manager config (terminal + daily token budget) ---
const terminalSelect = document.getElementById('terminal');
const voiceSelect = document.getElementById('voice');
for (const select of document.querySelectorAll('.sel select')) enhanceSelect(select);
const budgetInput = document.getElementById('budget');
const budgetLabel = document.getElementById('budget-label');
const usageLine = document.getElementById('usage-line');

const formatTokens = (value) =>
  value >= 1000
    ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0).replace('.', ',')}k`
    : String(value);

function renderBudgetLabel(value) {
  budgetLabel.textContent = value <= 0 ? '0' : formatTokens(value);
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
  refreshDropdowns();
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

const usageDetail = document.getElementById('usage-detail');
const usageBarFill = document.querySelector('#usage-bar > div');

function renderUsage(tokens) {
  if (!tokens) return;
  const used = formatTokens(tokens.usedToday);
  const budget = formatTokens(tokens.budget);
  usageLine.textContent =
    tokens.budget <= 0 ? 'ia desligada' : `tokens ${used}/${budget}${tokens.economy ? ' · eco' : ''}`;
  usageDetail.textContent =
    tokens.budget <= 0
      ? '# ia desligada por escolha sua — só frases prontas'
      : `hoje: ${used} / ${budget}`;
  const percent = tokens.budget > 0 ? Math.min(100, (tokens.usedToday / tokens.budget) * 100) : 0;
  usageBarFill.style.width = `${percent}%`;
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

window.manager.onChime(({ kind }) => {
  if (view === 'bubble') chime(kind);
});

// Spoken notifications stay short and instantly understandable — the full
// message lives in the tooltip/panel.
const TTS_PHRASES = {
  done: (projectName) => `Tarefa concluída no ${projectName}.`,
  question: (projectName) => `Pergunta pendente no ${projectName}.`,
  waiting: (projectName) => `O chat ${projectName} espera você.`,
};

const toastMark = document.getElementById('toast-mark');
const toastOrigin = document.getElementById('toast-origin');
const TOAST_TITLE = {
  done: 'término de task',
  question: 'pergunta pendente',
  waiting: 'esperando você',
  start: 'início de task',
};

document.getElementById('toast-open').addEventListener('click', openPanel);
document.getElementById('toast-close').addEventListener('click', (event) => {
  event.stopPropagation();
  hideTooltip();
});

window.manager.onTooltip(({ projectName, text, kind }) => {
  if (view === 'bubble') {
    chime(kind);
    if (ttsEnabled && !muted) {
      const phrase = TTS_PHRASES[kind] ?? TTS_PHRASES.waiting;
      window.manager.speak(phrase(projectName));
    }
  }
  const alert = kind === 'question' || kind === 'waiting';
  toastMark.textContent = alert ? '●' : '✓';
  toastMark.classList.toggle('warn', alert);
  tooltipProject.textContent = TOAST_TITLE[kind] ?? TOAST_TITLE.done;
  toastOrigin.textContent = `${projectName} · agora`;
  tooltipText.textContent = text;
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
  input.placeholder = 'resposta rápida…';
  input.value = replyDrafts.get(session.id) ?? '';
  const sendButton = document.createElement('button');
  sendButton.textContent = '[enviar]';
  sendButton.title = 'Enviar pro chat no terminal';
  const feedback = document.createElement('div');
  feedback.className = 'reply-feedback';
  feedback.textContent = replyFeedback.get(session.id) ?? '';

  const FEEDBACK_TEXT = {
    typed: '✓ enviado pro chat',
    clipboard: '# copiado! cola no chat',
    failed: '# não consegui enviar — tenta de novo',
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
  const state = session.question ? 'question' : session.status;
  const card = document.createElement('div');
  card.className = `session ${state}${session.unread ? ' unread' : ''}`;
  card.title = 'Abrir no terminal';
  card.addEventListener('click', () => window.manager.focusSession(session.id));

  const top = document.createElement('div');
  top.className = 'session-top';
  const dot = document.createElement('span');
  dot.className = `dot ${state}`;
  const name = document.createElement('span');
  name.className = 'name';
  // "Tema" do chat: título gerado pela IA > primeiro prompt > pasta.
  name.textContent = session.title ?? session.promptPreview ?? session.projectName;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = `${STATUS_LABEL[state] ?? state} ${relativeTime(session.updatedAt)}`;
  top.append(dot, name, time);
  card.append(top);

  const project = document.createElement('div');
  project.className = 'title';
  project.textContent = `└ ${session.projectName}`;
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
    dismiss.textContent = '[x]';
    dismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      window.manager.dismissMessage(session.id);
    });
    balloon.append(dismiss);
    const text = document.createElement('div');
    if (session.question?.questions?.length) {
      text.textContent = messageText;
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

// The bubble mirrors the sessions as a whole: someone waiting wins over
// someone working, and an idle bubble carries no badge at all.
function renderBadge(sessions) {
  const waiting = sessions.some((s) => s.question || s.status === 'waiting');
  const working = sessions.some((s) => s.status === 'working');
  badge.className = waiting ? 'waiting' : working ? 'working' : '';
  badge.style.display = waiting || working ? 'block' : 'none';
}

const updateBanner = document.getElementById('update-banner');
updateBanner.addEventListener('click', () => window.manager.applyUpdate());

function renderUpdateBanner(update) {
  if (!update || (!update.available && !update.ready)) {
    updateBanner.classList.add('hidden');
    return;
  }
  updateBanner.classList.remove('hidden');
  if (update.ready) {
    updateBanner.textContent = `⇡ v${update.ready} pronta — [reiniciar agora]`;
  } else if (update.mode === 'auto') {
    updateBanner.textContent = `⇣ baixando v${update.available}…`;
  } else {
    updateBanner.textContent = `⇡ v${update.available} disponível — [baixar]`;
  }
}

const voiceStatusLine = document.getElementById('voice-status');

function renderVoiceStatus(voice) {
  voiceStatusLine.classList.toggle('hidden', !voice);
  if (!voice) return;
  voiceStatusLine.replaceChildren();
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '⇣';
  voiceStatusLine.append(arrow);
  voiceStatusLine.append(
    document.createTextNode(` baixando ${voice}… falo com a voz do sistema até terminar`),
  );
}

window.manager.onState((state) => {
  renderUpdateBanner(state.update);
  renderVoiceStatus(state.voiceDownloading);
  renderUsage(state.tokens);
  renderBadge(state.sessions);
  lastUnreadCount = state.unread;

  sessionsContainer.replaceChildren();
  if (!state.sessions.length) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = '# nenhuma sessão por enquanto — manda o claude trabalhar que eu te aviso';
    sessionsContainer.append(empty);
    return;
  }
  for (const session of state.sessions) {
    sessionsContainer.append(sessionElement(session));
  }
});
