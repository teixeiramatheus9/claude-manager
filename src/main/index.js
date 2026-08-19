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
import { setupUpdater } from './updater.js';
import { socketPath, stateFile, sessionsFile, configFile, usageFile, configDir } from './paths.js';
import { log } from './log.js';
import { resolveDisplayMode, shouldRelaunchUnderX11 } from './display-mode.js';
import { readSessionChannel } from './cc-sessions.js';
import { readInboundPolicy, setInboundPolicy } from './claude-settings.js';
import { sendUserMessage } from './cc-peer.js';

// Two window-management modes:
// - X11/XWayland ("managed"): the app moves/positions its own window —
//   hold-anywhere drag with click detection, edge-aware flipping, persisted
//   position. mutter honours _NET_WM_STATE_ABOVE and _NET_WM_STATE_STICKY for
//   XWayland clients, which is the only way to get a real overlay on GNOME.
// - Wayland: the compositor owns positioning, so the bubble is a
//   -webkit-app-region drag handle and the window only grows/shrinks in place.
// The app asks for XWayland via --ozone-platform=x11 (see package.json). The
// switch has to come from the command line: appendSwitch() from this file runs
// too late, because Chromium picks the platform before main.js executes.
const displayMode = resolveDisplayMode({
  display: process.env.DISPLAY,
  ozonePlatform: app.commandLine.getSwitchValue('ozone-platform'),
  sessionType: process.env.XDG_SESSION_TYPE,
});
const canPositionWindows = displayMode.managed;

// The AppImage launcher drops build.linux.executableArgs, so a packaged run can
// arrive here without the switch and silently lose the overlay. Relaunch once
// with it; the env marker is inherited by the new process and stops any loop.
const OZONE_RELAUNCH_MARKER = 'CLAUDE_MANAGER_OZONE_RELAUNCHED';

function relaunchUnderX11IfNeeded() {
  const needed = shouldRelaunchUnderX11({
    display: process.env.DISPLAY,
    platform: displayMode.platform,
    // argv, not the command-line store: Chromium fills ozone-platform in with
    // the platform it picked, so the store cannot tell chosen from defaulted.
    switchPassed: process.argv.some((arg) => arg.startsWith('--ozone-platform')),
    alreadyRelaunched: Boolean(process.env[OZONE_RELAUNCH_MARKER]),
  });
  if (!needed) return false;
  log('relaunching with --ozone-platform=x11 (the launcher did not pass it)');
  process.env[OZONE_RELAUNCH_MARKER] = '1';
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
  app.exit(0);
  return true;
}

// Associates the running window with the installed .desktop entry so desktop
// environments show the right icon/name for packaged builds.
app.setDesktopName?.('claude-manager.desktop');

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(currentDir, '..', 'renderer');
const preloadPath = path.join(rendererDir, 'preload.cjs');
const iconPath = path.join(currentDir, '..', '..', 'assets', 'icon.png');

const MODE_SIZES = {
  bubble: { width: 80, height: 80 },
  tooltip: { width: 368, height: 116 },
  panel: { width: 380, height: 526 },
};
const BUBBLE_BOX = MODE_SIZES.bubble.width;
const CLICK_THRESHOLD_PX = 6;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

const registry = new SessionRegistry();
let managerConfig = loadConfig(configFile);
const tokenBudget = new TokenBudget({ file: usageFile });
const isEconomyMode = () => tokenBudget.isExceeded(managerConfig.tokenBudgetDaily);
let mainWindow = null;
let currentMode = 'bubble';
// Top-left corner of the bubble on screen — the fixed point every mode
// expansion is anchored to (only meaningful in managed/X11 mode).
let bubbleAnchor = null;
let flipped = false;
let dragState = null;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

let updateStatus = { mode: 'off', available: null, ready: null };
let updaterHandle = { apply: () => {} };
let announcedUpdateVersion = null;

function sendState() {
  sendToRenderer('state', {
    sessions: registry.list(),
    unread: registry.unreadCount(),
    update: updateStatus,
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

function applyModeBounds(mode) {
  const size = MODE_SIZES[mode];
  mainWindow.setMinimumSize(size.width, size.height);
  mainWindow.setMaximumSize(size.width, size.height);

  if (!canPositionWindows || !bubbleAnchor) {
    mainWindow.setSize(size.width, size.height);
    return;
  }

  const workArea = screen.getDisplayNearestPoint(bubbleAnchor).workArea;
  const overflowsRight = bubbleAnchor.x + size.width > workArea.x + workArea.width;
  flipped = mode !== 'bubble' && overflowsRight;
  let x = flipped ? bubbleAnchor.x + BUBBLE_BOX - size.width : bubbleAnchor.x;
  x = Math.max(workArea.x, x);
  let y = bubbleAnchor.y;
  if (y + size.height > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - size.height;
  }
  y = Math.max(workArea.y, y);
  mainWindow.setBounds({ x, y, width: size.width, height: size.height });
  sendToRenderer('ui:flip', flipped);
}

function createMainWindow() {
  const options = {
    width: MODE_SIZES.bubble.width,
    height: MODE_SIZES.bubble.height,
    icon: iconPath,
    frame: false,
    transparent: true,
    // resizable stays true because resizable:false breaks -webkit-app-region
    // drag on Linux; the size is pinned via min/max in applyModeBounds.
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: preloadPath, contextIsolation: true },
  };

  if (canPositionWindows) {
    const saved = loadPersistedState().bubble;
    const workArea = screen.getPrimaryDisplay().workArea;
    bubbleAnchor = {
      x: saved?.x ?? workArea.x + workArea.width - BUBBLE_BOX - 24,
      y: saved?.y ?? workArea.y + Math.round(workArea.height * 0.45),
    };
    options.x = bubbleAnchor.x;
    options.y = bubbleAnchor.y;
  }

  mainWindow = new BrowserWindow(options);
  applyModeBounds('bubble');
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  // visibleOnFullScreen forces accessory mode on macOS, which hides the
  // dock icon — there the dock wins over overlaying fullscreen apps.
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: process.platform !== 'darwin',
  });
  mainWindow.loadFile(path.join(rendererDir, 'app.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    sendToRenderer('ui:env', { managed: canPositionWindows });
    sendState();
  });
  mainWindow.on('blur', () => sendToRenderer('ui:blur'));
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

ipcMain.on('ui:mode', (_event, mode) => {
  if (!MODE_SIZES[mode] || !mainWindow || mainWindow.isDestroyed()) return;
  currentMode = mode;
  applyModeBounds(mode);
});

ipcMain.on('panel:opened', () => registry.markAllRead());

ipcMain.on('message:dismiss', (_event, sessionId) => registry.dismissMessage(sessionId));

ipcMain.on('update:apply', () => updaterHandle.apply());

ipcMain.on('tts:speak', (_event, rawText) => {
  const text = String(rawText ?? '').slice(0, 300);
  if (!text) return;
  tts.stopSpeaking();
  try {
    tts.speak(text);
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
}));

ipcMain.handle('config:set', (_event, partial) => {
  const allowed = {};
  if (typeof partial?.terminal === 'string') allowed.terminal = partial.terminal;
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
    allowInputInjection: displayMode.canInjectInput,
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

  // Sending the option's own text beats simulating Down x N + Return: it needs
  // no window, and it cannot land on the wrong option if the list scrolled.
  const optionText = session.question?.questions?.[0]?.options?.[index];
  const channel = readSessionChannel(session.id);
  if (channel && typeof optionText === 'string' && optionText.trim()) {
    const outcome = await sendUserMessage(channel.socketPath, optionText, {
      token: channel.token,
    });
    if (outcome === 'sent') {
      registry.markAnswered(sessionId);
      return 'answered';
    }
    log(`peer channel unusable for answer on ${session.id} (${outcome})`);
  }

  const result = await terminal.answerQuestionInWarp(sessionSearchKeys(session), index, {
    terminal: managerConfig.terminal,
    allowInputInjection: displayMode.canInjectInput,
    wave: session?.wave,
  });
  if (result === 'answered') registry.markAnswered(sessionId);
  return result;
});

// Reply path, in order of preference:
// 1. The session's own unix socket — works on Wayland, on any terminal, and
//    cannot deliver to the wrong chat because it is addressed by session id.
// 2. The terminal window (xdotool), for builds where the messaging channel is
//    gated off or the session predates it.
async function replyToSession(session, text) {
  const channel = session?.id ? readSessionChannel(session.id) : null;
  if (channel) {
    const outcome = await sendUserMessage(channel.socketPath, text, { token: channel.token });
    if (outcome === 'sent') return 'sent';
    log(`peer channel unusable for ${session.id} (${outcome}) — falling back to the terminal`);
  }
  return terminal.sendReplyToWarp(sessionSearchKeys(session), text, {
    writeClipboard: (value) => clipboard.writeText(value),
    terminal: managerConfig.terminal,
    allowInputInjection: displayMode.canInjectInput,
    wave: session?.wave,
  });
}

ipcMain.handle('warp:reply', async (_event, { sessionId, text }) => {
  const session = registry.sessions.get(sessionId);
  const reply = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!reply) return 'failed';
  return replyToSession(session, reply);
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
  const width = mainWindow.getBounds().width;
  bubbleAnchor = {
    x: flipped && currentMode !== 'bubble' ? x + width - BUBBLE_BOX : x,
    y,
  };
  persistAnchor();
});

// Self-registers the Claude Code hooks on startup, so packaged installs
// (AppImage/deb/rpm) work out of the box. ELECTRON_RUN_AS_NODE turns this
// app's own binary into the hook runtime — no system Node required.
const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');

function readClaudeSettings() {
  try {
    return JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
  } catch {
    return {}; // no settings yet — start from empty
  }
}

// Every write backs the file up first: this is the user's global Claude Code
// config, not the app's own.
function writeClaudeSettings(next) {
  if (fs.existsSync(claudeSettingsPath)) {
    fs.copyFileSync(claudeSettingsPath, `${claudeSettingsPath}.claude-manager-${Date.now()}.bak`);
  }
  fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
  fs.writeFileSync(claudeSettingsPath, `${JSON.stringify(next, null, 2)}\n`);
}

function ensureHooksInstalled() {
  try {
    const hookScript = path.join(currentDir, '..', 'hook', 'hook-emit.js');
    const command = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${hookScript}"`;
    const settings = readClaudeSettings();
    const next = ensureHooks(settings, command);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    writeClaudeSettings(next);
    log(`hooks self-installed: ${command}`);
  } catch (error) {
    log(`ensureHooksInstalled failed: ${error}`);
  }
}

// crossSessionInbound decides what a session does with the quick reply this app
// sends. It lives in the user's Claude Code settings, so the app only ever
// writes the user level — a repo or managed setting can still tighten it, and
// the panel says so instead of promising an outcome.
ipcMain.handle('inbound:get', () => readInboundPolicy(readClaudeSettings()));

ipcMain.handle('inbound:set', (_event, value) => {
  const settings = readClaudeSettings();
  const next = setInboundPolicy(settings, value);
  if (!next) {
    log(`inbound policy refused: ${value}`);
    return readInboundPolicy(settings);
  }
  try {
    writeClaudeSettings(next);
    log(`crossSessionInbound set to ${value}`);
  } catch (error) {
    log(`inbound policy write failed: ${error}`);
    return readInboundPolicy(settings);
  }
  return readInboundPolicy(next);
});

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
  if (relaunchUnderX11IfNeeded()) return;
  log(
    `display mode: platform=${displayMode.platform} managed=${displayMode.managed} `.concat(
      `canInjectInput=${displayMode.canInjectInput}`,
    ),
  );
  ensureHooksInstalled();
  hydrateRegistry();
  createMainWindow();
  startSocketServer(socketPath, onHookEvent, log);
  registry.on('change', sendState);
  registry.on('change', scheduleSessionsSave);
  setInterval(() => registry.prune(), PRUNE_INTERVAL_MS);
  updaterHandle = setupUpdater({ onStatus: onUpdateStatus, log });
});

app.on('window-all-closed', () => app.quit());
