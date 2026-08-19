import { app, BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHooks } from '../../scripts/install-hooks.js';
import { SessionRegistry } from './session-registry.js';
import { startSocketServer } from './socket-server.js';
import { readTranscriptSnapshot } from './transcript.js';
import { generateManagerMessage, humanizeNotification } from './manager-voice.js';
import { askManager, findMentionedSession } from './manager-chat.js';
import { fallbackMessage } from './manager-voice.js';
import { loadConfig, saveConfig } from './config-store.js';
import { TokenBudget } from './token-budget.js';
import { terminal, tts } from './platform.js';
import { VOICES } from './sherpa-installer.js';
import { setupUpdater } from './updater.js';
import { socketPath, stateFile, sessionsFile, configFile, usageFile, configDir } from './paths.js';
import { log } from './log.js';

// Two window-management modes, detected from the session type:
// - X11 ("managed"): the app moves/positions its own window — hold-anywhere
//   drag with click detection, edge-aware flipping, persisted position.
// - Wayland: the compositor owns positioning, so the bubble is a
//   -webkit-app-region drag handle and the window only grows/shrinks in
//   place. (XWayland is NOT an option on this Iris Xe/Mesa stack: Electron
//   never paints its windows there, no matter the GL backend.)
const canPositionWindows = process.env.XDG_SESSION_TYPE !== 'wayland';

// Associates the running window with the installed .desktop entry so desktop
// environments show the right icon/name for packaged builds.
app.setDesktopName?.('claude-manager.desktop');

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(currentDir, '..', 'renderer');
const preloadPath = path.join(rendererDir, 'preload.cjs');
const iconPath = path.join(currentDir, '..', '..', 'assets', 'icon.png');

const MODE_SIZES = {
  bubble: { width: 56, height: 56 },
  tooltip: { width: 404, height: 100 },
  panel: { width: 436, height: 552 },
};
const BUBBLE_BOX = MODE_SIZES.bubble.width;
const TOOLTIP_HIDE_MS = 8000;
const CLICK_THRESHOLD_PX = 6;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

const registry = new SessionRegistry();
let managerConfig = loadConfig(configFile);
const tokenBudget = new TokenBudget({ file: usageFile });
const isEconomyMode = () => tokenBudget.isExceeded(managerConfig.tokenBudgetDaily);
let mainWindow = null;
let overlayWindow = null;
// Top-left corner of the bubble on screen — where the overlay is anchored.
let bubbleAnchor = null;
let dragState = null;

function sendToRenderer(channel, payload) {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

let updateStatus = { mode: 'off', available: null, ready: null };
let updaterHandle = { apply: () => {} };
let announcedUpdateVersion = null;

function sendState() {
  sendToRenderer('state', {
    sessions: registry.list(),
    unread: registry.unreadCount(),
    update: updateStatus,
    voiceDownloading: tts.downloadingVoice(),
    tokens: {
      usedToday: tokenBudget.usedToday(),
      budget: managerConfig.tokenBudgetDaily,
      economy: isEconomyMode(),
    },
  });
}

function onUpdateStatus(status) {
  updateStatus = status;
  sendState();
  const version = status.ready ?? status.available;
  if (!version || announcedUpdateVersion === version) return;
  announcedUpdateVersion = version;
  sendToRenderer('tooltip', {
    projectName: 'Claude Manager',
    text: status.ready
      ? `Atualização v${version} pronta! Clica no banner do painel pra reiniciar.`
      : `Versão v${version} disponível!`,
    kind: 'done',
  });
}

function loadPersistedState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function persistAnchor() {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ bubble: bubbleAnchor }));
  } catch (error) {
    log(`persistAnchor failed: ${error}`);
  }
}

// The bubble lives in its own window that is never resized or moved on its
// own: resizing a transparent window on macOS repaints the old frame into the
// new geometry, which shows up as a ghost of the bubble. The panel and the
// toast live in a second window that is always positioned while hidden.
const OVERLAY_GAP = 8;

function overlayBounds(mode) {
  const size = MODE_SIZES[mode];
  const anchor = bubbleAnchor ?? { x: 0, y: 0 };
  const workArea = screen.getDisplayNearestPoint(anchor).workArea;
  let x = anchor.x + BUBBLE_BOX + OVERLAY_GAP;
  if (x + size.width > workArea.x + workArea.width) x = anchor.x - OVERLAY_GAP - size.width;
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width));
  let y = anchor.y;
  if (y + size.height > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - size.height;
  }
  y = Math.max(workArea.y, y);
  return { x, y, width: size.width, height: size.height };
}

let overlayMode = null;
let tooltipTimer = null;
// Clicking the bubble blurs the panel, which already closes it — without
// this the click that follows would just open it right back up.
let closedByBlurAt = 0;
let openedAt = 0;
const JUST_CLOSED_MS = 150;
// Clicking the bubble hands focus back to its window right after the panel
// opens; without this settle window the panel would blur itself shut.
const SETTLE_MS = 500;

function showOverlay(mode, { focus = false } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayMode = mode;
  overlayWindow.setBounds(overlayBounds(mode));
  overlayWindow.webContents.send('overlay:mode', mode);
  if (focus) overlayWindow.show();
  else overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

}

function hideOverlay() {
  clearTimeout(tooltipTimer);
  overlayMode = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
}

function openPanel() {
  clearTimeout(tooltipTimer);
  registry.markAllRead();
  openedAt = Date.now();
  showOverlay('panel', { focus: true });
}

function showTooltip() {
  if (overlayMode === 'panel') return;
  showOverlay('tooltip');
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideOverlay, TOOLTIP_HIDE_MS);
}

ipcMain.on('overlay:toggle-panel', () => {
  if (overlayMode === 'panel') return hideOverlay();
  if (Date.now() - closedByBlurAt < JUST_CLOSED_MS) return;
  openPanel();
});
ipcMain.on('overlay:open-panel', () => openPanel());
ipcMain.on('overlay:close', () => hideOverlay());

ipcMain.on('app:quit', () => app.quit());

const windowOptions = {
  icon: iconPath,
  frame: false,
  transparent: true,
  // resizable stays true because resizable:false breaks -webkit-app-region
  // drag on Linux.
  resizable: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  webPreferences: { preload: preloadPath, contextIsolation: true },
};

// visibleOnFullScreen turns the app into an accessory on macOS (no dock
// icon), which is why the panel carries its own quit action.
function stayOnTop(win) {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createWindows() {
  const saved = loadPersistedState().bubble;
  const workArea = screen.getPrimaryDisplay().workArea;
  bubbleAnchor = {
    x: saved?.x ?? workArea.x + workArea.width - BUBBLE_BOX - 24,
    y: saved?.y ?? workArea.y + Math.round(workArea.height * 0.45),
  };

  mainWindow = new BrowserWindow({
    ...windowOptions,
    width: BUBBLE_BOX,
    height: BUBBLE_BOX,
    ...(canPositionWindows ? { x: bubbleAnchor.x, y: bubbleAnchor.y } : {}),
  });
  mainWindow.setMinimumSize(BUBBLE_BOX, BUBBLE_BOX);
  mainWindow.setMaximumSize(BUBBLE_BOX, BUBBLE_BOX);
  stayOnTop(mainWindow);
  mainWindow.loadFile(path.join(rendererDir, 'app.html'), { query: { view: 'bubble' } });
  mainWindow.webContents.on('did-finish-load', () => {
    sendToRenderer('ui:env', { managed: canPositionWindows });
    sendState();
  });

  overlayWindow = new BrowserWindow({
    ...windowOptions,
    width: MODE_SIZES.panel.width,
    height: MODE_SIZES.panel.height,
    show: false,
  });
  stayOnTop(overlayWindow);
  overlayWindow.loadFile(path.join(rendererDir, 'app.html'), { query: { view: 'overlay' } });
  overlayWindow.webContents.on('did-finish-load', sendState);
  // Focus bounces back to the bubble window right after a click, so a bare
  // blur is not enough: the panel only closes when no window of ours is
  // focused any more — that is, when the click really landed outside.
  overlayWindow.on('blur', () => {
    if (overlayMode !== 'panel' || Date.now() - openedAt < SETTLE_MS) return;
    setTimeout(() => {
      if (overlayMode !== 'panel') return;
      const ours = [mainWindow, overlayWindow].some((win) => win && !win.isDestroyed() && win.isFocused());
      if (ours) return;
      hideOverlay();
      closedByBlurAt = Date.now();
    }, 120);
  });
}

async function generateVoiceForStop(session) {
  const snapshot = session.transcriptPath
    ? await readTranscriptSnapshot(session.transcriptPath)
    : { lastAssistantMessage: null, pendingQuestion: null };
  // A Stop can itself end on a question ("which option do you want?"), so a
  // pending ask found here is shown too instead of being discarded.
  registry.setQuestion(session.id, snapshot.pendingQuestion);
  let voice;
  if (isEconomyMode()) {
    voice = fallbackMessage(session.projectName);
  } else {
    voice = await generateManagerMessage({
      projectName: session.projectName,
      lastAssistantMessage: snapshot.lastAssistantMessage,
    });
    tokenBudget.add(voice.tokensUsed);
  }
  registry.setManagerMessage(session.id, voice);
  sendToRenderer('tooltip', { projectName: session.projectName, text: voice.message, kind: 'done' });
  showTooltip();
}

async function enrichNotification(session) {
  const snapshot = session.transcriptPath
    ? await readTranscriptSnapshot(session.transcriptPath)
    : { pendingQuestion: null };
  registry.setQuestion(session.id, snapshot.pendingQuestion);
  const firstQuestion = snapshot.pendingQuestion?.questions?.[0];
  // The card shows exactly what the tooltip showed — one message per chat.
  const text = firstQuestion?.question ?? session.managerMessage;
  if (!text) return;
  if (firstQuestion) registry.setManagerMessage(session.id, { message: text });
  sendToRenderer('tooltip', {
    projectName: session.projectName,
    text,
    kind: firstQuestion ? 'question' : 'waiting',
  });
  showTooltip();
}

function onHookEvent(event) {
  if (event?.hook_event_name === 'Notification') {
    event = { ...event, message: humanizeNotification(event.message) };
  }
  const session = registry.applyEvent(event);
  if (!session) return;
  if (event.hook_event_name === 'Stop') {
    generateVoiceForStop(session).catch((error) => log(`voice generation failed: ${error}`));
  } else if (event.hook_event_name === 'Notification') {
    enrichNotification(session).catch((error) => log(`notification enrich failed: ${error}`));
  } else if (event.hook_event_name === 'UserPromptSubmit') {
    sendToRenderer('chime', { kind: 'start' });
  }
}

ipcMain.on('panel:opened', () => registry.markAllRead());

ipcMain.on('message:dismiss', (_event, sessionId) => registry.dismissMessage(sessionId));

ipcMain.on('update:apply', () => updaterHandle.apply());

ipcMain.on('tts:speak', (_event, rawText) => {
  const text = String(rawText ?? '').slice(0, 300);
  if (!text) return;
  tts.stopSpeaking();
  try {
    tts.speak(text, { voice: managerConfig.voice });
  } catch (error) {
    log(`tts failed: ${error}`);
  }
});

// --- manager chat (token-frugal: local digest, excerpt only on mention) ---
const CHAT_HISTORY_LIMIT = 12;
const chatHistory = [];

const ECONOMY_CHAT_REPLY =
  'Atingi o limite de tokens de hoje que você definiu 😴 Sobe a barrinha nas configurações se quiser que eu volte a pensar.';

ipcMain.handle('manager:chat', async (_event, rawMessage) => {
  const userMessage = String(rawMessage ?? '').trim().slice(0, 1000);
  if (!userMessage) return '';
  if (isEconomyMode()) return ECONOMY_CHAT_REPLY;
  const sessions = registry.list();
  const mentioned = findMentionedSession(sessions, userMessage);
  const transcriptExcerpt = mentioned?.transcriptPath
    ? (await readTranscriptSnapshot(mentioned.transcriptPath)).lastAssistantMessage
    : null;
  const { reply, tokensUsed } = await askManager({
    sessions,
    history: chatHistory,
    userMessage,
    transcriptExcerpt,
  });
  tokenBudget.add(tokensUsed);
  sendState();
  chatHistory.push({ role: 'user', text: userMessage }, { role: 'manager', text: reply });
  while (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
  return reply;
});

ipcMain.handle('config:get', () => ({
  ...managerConfig,
  terminals: Object.entries(terminal.TERMINALS).map(([value, spec]) => ({
    value,
    label: spec.label,
  })),
  voices: Object.entries(VOICES).map(([value, spec]) => ({ value, label: spec.label })),
}));

ipcMain.handle('config:set', (_event, partial) => {
  const allowed = {};
  if (typeof partial?.terminal === 'string') allowed.terminal = partial.terminal;
  if (typeof partial?.voice === 'string' && VOICES[partial.voice]) allowed.voice = partial.voice;
  if (Number.isFinite(partial?.tokenBudgetDaily)) {
    allowed.tokenBudgetDaily = Math.max(0, Math.round(partial.tokenBudgetDaily));
  }
  managerConfig = { ...managerConfig, ...allowed };
  try {
    saveConfig(configFile, managerConfig);
  } catch (error) {
    log(`config save failed: ${error}`);
  }
  sendState();
  // Speaking the sample also pulls the model when it is not there yet.
  if (allowed.voice) tts.speak('Voz trocada. Agora eu falo assim!', { voice: allowed.voice });
  return managerConfig;
});

// Remembers the exact window title each session was last found under, so the
// next hunt hits it instantly instead of cycling tabs again.
const matchedTitleCache = new Map();

function sessionSearchKeys(session) {
  // Warp tabs running Claude Code are titled with the chat THEME, plain
  // shell tabs usually show the cwd — so hunt by both kinds of name.
  return [
    matchedTitleCache.get(session?.id),
    session?.projectName,
    session?.title,
    session?.promptPreview,
  ];
}

async function huntSessionTab(session) {
  const result = await terminal.focusChatTab(sessionSearchKeys(session), {
    terminal: managerConfig.terminal,
    wave: session?.wave,
  });
  if (session?.id) {
    if (result.tabFound && result.matchedTitle) {
      matchedTitleCache.set(session.id, result.matchedTitle);
    } else if (!result.tabFound) {
      matchedTitleCache.delete(session?.id);
    }
  }
  return result;
}

ipcMain.handle('warp:focus', (_event, sessionId) => {
  const session = registry.sessions.get(sessionId);
  return huntSessionTab(session);
});

ipcMain.handle('warp:answer', async (_event, { sessionId, optionIndex }) => {
  const session = registry.sessions.get(sessionId);
  const index = Number(optionIndex);
  if (!session || !Number.isInteger(index) || index < 0) return 'failed';
  const result = await terminal.answerQuestionInWarp(sessionSearchKeys(session), index, {
    terminal: managerConfig.terminal,
    wave: session?.wave,
  });
  if (result === 'answered') registry.markAnswered(sessionId);
  return result;
});

ipcMain.handle('warp:reply', (_event, { sessionId, text }) => {
  const session = registry.sessions.get(sessionId);
  const reply = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!reply) return 'failed';
  return terminal.sendReplyToWarp(sessionSearchKeys(session), reply, {
    writeClipboard: (value) => clipboard.writeText(value),
    terminal: managerConfig.terminal,
    wave: session?.wave,
  });
});

// Manual drag (managed/X11 mode only): the renderer reports press/release on
// the bubble; main polls the cursor, moves the window, and tells the
// renderer when a press was really just a click.
ipcMain.on('drag:start', () => {
  if (!canPositionWindows || !mainWindow || mainWindow.isDestroyed()) return;
  if (dragState) clearInterval(dragState.timer);
  const startCursor = screen.getCursorScreenPoint();
  const [windowX, windowY] = mainWindow.getPosition();
  dragState = {
    startCursor,
    offset: { x: startCursor.x - windowX, y: startCursor.y - windowY },
    moved: false,
    timer: setInterval(() => {
      const cursor = screen.getCursorScreenPoint();
      const distance =
        Math.abs(cursor.x - dragState.startCursor.x) + Math.abs(cursor.y - dragState.startCursor.y);
      if (distance > CLICK_THRESHOLD_PX) dragState.moved = true;
      if (dragState.moved) {
        mainWindow.setPosition(cursor.x - dragState.offset.x, cursor.y - dragState.offset.y);
      }
    }, 16),
  };
});

ipcMain.on('drag:end', () => {
  if (!dragState) return;
  clearInterval(dragState.timer);
  const wasDragged = dragState.moved;
  dragState = null;
  if (!wasDragged) {
    sendToRenderer('ui:click');
    return;
  }
  const [x, y] = mainWindow.getPosition();
  const center = { x: x + BUBBLE_BOX / 2, y: y + BUBBLE_BOX / 2 };
  const workArea = screen.getDisplayNearestPoint(center).workArea;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  bubbleAnchor = {
    x: clamp(x, workArea.x, workArea.x + workArea.width - BUBBLE_BOX),
    y: clamp(y, workArea.y, workArea.y + workArea.height - BUBBLE_BOX),
  };
  mainWindow.setPosition(bubbleAnchor.x, bubbleAnchor.y);
  persistAnchor();
  // Moving across displays can drop the window behind others.
  stayOnTop(mainWindow);
  if (overlayMode) showOverlay(overlayMode, { focus: overlayMode === 'panel' });
});

// Self-registers the Claude Code hooks on startup, so packaged installs
// (AppImage/deb/rpm) work out of the box. ELECTRON_RUN_AS_NODE turns this
// app's own binary into the hook runtime — no system Node required.
function ensureHooksInstalled() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const hookScript = path.join(currentDir, '..', 'hook', 'hook-emit.js');
    const command = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${hookScript}"`;
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // no settings yet — start from empty
    }
    const next = ensureHooks(settings, command);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    if (fs.existsSync(settingsPath)) {
      fs.copyFileSync(settingsPath, `${settingsPath}.claude-manager-${Date.now()}.bak`);
    }
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
    log(`hooks self-installed: ${command}`);
  } catch (error) {
    log(`ensureHooksInstalled failed: ${error}`);
  }
}

function hydrateRegistry() {
  try {
    registry.hydrate(JSON.parse(fs.readFileSync(sessionsFile, 'utf8')));
    registry.prune();
  } catch {
    // first run or corrupt file — start fresh
  }
}

let saveTimer = null;
function scheduleSessionsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(sessionsFile, JSON.stringify(registry.serialize()));
    } catch (error) {
      log(`sessions save failed: ${error}`);
    }
  }, 500);
}

// A second instance would unlink and take over the unix socket, leaving the
// first one running but unreachable by the hooks.
if (!app.requestSingleInstanceLock()) app.exit(0);

app.whenReady().then(() => {
  tts.watchDownloads(() => sendState());
  ensureHooksInstalled();
  hydrateRegistry();
  createWindows();
  startSocketServer(socketPath, onHookEvent, log);
  registry.on('change', sendState);
  registry.on('change', scheduleSessionsSave);
  setInterval(() => registry.prune(), PRUNE_INTERVAL_MS);
  updaterHandle = setupUpdater({ onStatus: onUpdateStatus, log });
});

app.on('window-all-closed', () => app.quit());
