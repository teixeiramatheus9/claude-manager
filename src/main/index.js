import { app, BrowserWindow, clipboard, ipcMain, Menu, screen, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHooks, removeAppHooks } from '../../scripts/install-hooks.js';
import { SessionRegistry } from './session-registry.js';
import { startSocketServer, stopSocketServer } from './socket-server.js';
import { readTranscriptSnapshot } from './transcript.js';
import { generateManagerMessage, humanizeNotification } from './manager-voice.js';
import { digestMessage } from './message-digest.js';
import { askManager, findMentionedSession } from './manager-chat.js';
import { fallbackMessage } from './manager-voice.js';
import { loadConfig, saveConfig } from './config-store.js';
import { TokenBudget } from './token-budget.js';
import { terminal, tts } from './platform.js';
import { VOICES } from './sherpa-installer.js';
import { THEMES } from './themes.js';
import { PANEL_SCALE, clampScale, panelSizeForScale } from './panel-size.js';
import { setupUpdater } from './updater.js';
import { detectTrayHost, trayMenuTemplate } from './tray.js';
import { installTraySupport, shouldInstallTraySupport } from './tray-support.js';
import { killPendingClaude } from './claude-cli.js';
import {
  socketPath,
  stateFile,
  sessionsFile,
  configFile,
  usageFile,
  updateNoticeFile,
  configDir,
} from './paths.js';
import { UPDATE_DONE_PHRASE, shouldAnnounce } from './update-notice.js';
import { log } from './log.js';
import { resolveDisplayMode, shouldRelaunchUnderX11 } from './display-mode.js';
import { readSessionChannel, readLiveSessionIds } from './cc-sessions.js';
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
// macOS has neither DISPLAY nor a session type to read: Quartz always lets the
// app place its own windows, and input goes through System Events.
const displayMode =
  process.platform === 'darwin'
    ? { platform: 'darwin', managed: true, canInjectInput: true }
    : resolveDisplayMode({
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
const execFileAsync = promisify(execFile);
const iconPath = path.join(currentDir, '..', '..', 'assets', 'icon.png');
// A panel shows the icon small over its own background: the app tile would be
// a dark smudge next to the other status icons, so the tray gets the glyph.
const trayIconPath = path.join(currentDir, '..', '..', 'assets', 'tray-icon.png');

const MODE_SIZES = {
  bubble: { width: 56, height: 56 },
  tooltip: { width: 404, height: 100 },
  panel: { width: 436, height: 552 },
};
const BUBBLE_BOX = MODE_SIZES.bubble.width;
// The panel size is a setting, not a drag: growing it zooms the contents by
// the same factor, so the text gets bigger instead of more rows fitting.
function panelScale() {
  return clampScale(managerConfig.panelScale) / 100;
}

function panelSize() {
  const workArea = screen.getDisplayNearestPoint(bubbleAnchor ?? { x: 0, y: 0 }).workArea;
  return panelSizeForScale(managerConfig.panelScale, MODE_SIZES.panel, workArea);
}
const TOOLTIP_HIDE_MS = 8000;
const CLICK_THRESHOLD_PX = 6;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
// Short, because a closed terminal should leave the list right away rather
// than sit there claiming the chat is still working.
const LIVENESS_INTERVAL_MS = 15 * 1000;

const registry = new SessionRegistry();
let managerConfig = loadConfig(configFile);
const tokenBudget = new TokenBudget({ file: usageFile });
const isEconomyMode = () => tokenBudget.isExceeded(managerConfig.tokenBudgetDaily);
let mainWindow = null;
let overlayWindow = null;
let tray = null;
let socketServer = null;
let trayNeedsRelogin = false;
// Top-left corner of the bubble on screen — where the overlay is anchored.
let bubbleAnchor = null;
let dragState = null;

function sendToRenderer(channel, payload) {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

let updateStatus = { mode: 'off', available: null, ready: null, installing: false };
let updaterHandle = { apply: () => {} };
let announcedUpdateVersion = null;

function sendState() {
  sendToRenderer('state', {
    sessions: registry.list(),
    unread: registry.unreadCount(),
    update: updateStatus,
    voiceDownloading: tts.downloadingVoice(),
    theme: managerConfig.theme,
    trayAvailable: Boolean(tray),
    trayNeedsRelogin,
    crt: managerConfig.crt,
    sound: {
      muted: managerConfig.muted,
      volume: managerConfig.soundVolume,
      voiceVolume: managerConfig.voiceVolume,
      timbre: managerConfig.timbre,
      ttsEnabled: managerConfig.ttsEnabled,
      typeVolumes: managerConfig.typeVolumes,
    },
    tokens: {
      usedToday: tokenBudget.usedToday(),
      budget: managerConfig.tokenBudgetDaily,
      economy: isEconomyMode(),
    },
  });
}

function onUpdateStatus(status) {
  const wasInstalling = updateStatus.installing;
  updateStatus = status;
  sendState();
  if (status.installing !== wasInstalling) {
    setFloatAboveEverything(!status.installing);
    if (status.installing) hideOverlay();
  }
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

const clampTo = (value, min, max) => Math.min(Math.max(value, min), max);

function overlayBounds(mode) {
  const size = mode === 'panel' ? panelSize() : MODE_SIZES[mode];
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
  overlayWindow.webContents.setZoomFactor(mode === 'panel' ? panelScale() : 1);
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

function bubbleVisible() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
}

function hideToTray() {
  hideOverlay();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  refreshTrayMenu();
}

function showBubble() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const actions = {
    panel: () => {
      showBubble();
      openPanel();
    },
    settings: () => {
      showBubble();
      openPanel();
      sendToRenderer('ui:open-settings');
    },
    toggle: () => (bubbleVisible() ? hideToTray() : showBubble()),
    quit: () => app.quit(),
  };
  const template = trayMenuTemplate({ bubbleVisible: bubbleVisible() }).map((item) =>
    item.id ? { ...item, click: actions[item.id] } : item,
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// Hiding into the tray is only offered where an icon can actually appear.
// GNOME without the appindicator extension has no host, and hiding there would
// leave no bubble, no menu and no way back — so the button keeps quitting.
async function setupTray() {
  const available = await detectTrayHost({ platform: process.platform, execFn: execFileAsync });
  if (!available) {
    const needsExtension = shouldInstallTraySupport({
      platform: process.platform,
      desktop: process.env.XDG_CURRENT_DESKTOP,
      hasTrayHost: false,
    });
    if (!needsExtension) {
      log('tray: this session has no tray — close keeps quitting for real');
      return;
    }
    // GNOME only loads an extension at startup, so the icon can never show up
    // in the session that installed it: say so instead of looking broken.
    const result = await installTraySupport({ execFn: execFileAsync, log }).catch((error) => {
      log(`tray support install failed: ${error}`);
      return null;
    });
    trayNeedsRelogin = Boolean(result);
    sendState();
    return;
  }
  tray = new Tray(trayIconPath);
  tray.setToolTip('Claude Manager');
  // GNOME's appindicator has no activate signal — a left click just opens the
  // menu — so the menu carries every action instead of relying on this.
  tray.on('click', () => {
    showBubble();
    openPanel();
  });
  refreshTrayMenu();
  sendState();
}

ipcMain.on('app:quit', () => (tray ? hideToTray() : app.quit()));


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
// Dropped while a package installs: the system asks for a password in its own
// dialog, and a screen-saver-level overlay would sit on top of it — the user
// would see the prompt but never reach it.
let floatAboveEverything = true;

function stayOnTop(win) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(floatAboveEverything, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function setFloatAboveEverything(enabled) {
  if (floatAboveEverything === enabled) return;
  floatAboveEverything = enabled;
  for (const win of [mainWindow, overlayWindow]) stayOnTop(win);
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
  registry.setLastMessage(session.id, digestMessage(snapshot.lastAssistantMessage));
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

// The Notification hook often fires BEFORE Claude Code flushes the ask entry
// to the transcript — reading immediately misses the question and the card
// shows no options. Retry a few times before giving up.
const QUESTION_RETRY_DELAYS_MS = [0, 600, 1500];

async function readSnapshotWithQuestionRetry(transcriptPath) {
  let snapshot = { lastAssistantMessage: null, pendingQuestion: null };
  for (const delayMs of QUESTION_RETRY_DELAYS_MS) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    snapshot = await readTranscriptSnapshot(transcriptPath);
    if (snapshot.pendingQuestion) return snapshot;
  }
  return snapshot;
}

async function enrichNotification(session) {
  const snapshot = session.transcriptPath
    ? await readSnapshotWithQuestionRetry(session.transcriptPath)
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
    optionsCount: firstQuestion?.options?.length ?? 0,
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

ipcMain.on('session:remove', (_event, sessionId) => registry.remove(sessionId));

ipcMain.on('update:apply', () => {
  const version = updateStatus.ready ?? updateStatus.available;
  try {
    if (version) fs.writeFileSync(updateNoticeFile, JSON.stringify({ version }));
  } catch (error) {
    log(`update notice failed: ${error}`);
  }
  updaterHandle.apply();
});

ipcMain.handle('update:check', async () => {
  const status = await (updaterHandle.check?.() ?? updateStatus);
  return { ...status, currentVersion: app.getVersion() };
});

ipcMain.on('tts:speak', (_event, payload) => {
  const text = String(payload?.text ?? payload ?? '').slice(0, 300);
  if (!text) return;
  const volume = Number.isFinite(payload?.volume) ? payload.volume : 100;
  tts.stopSpeaking();
  try {
    tts.speak(text, { voice: managerConfig.voice, volume });
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
  themes: Object.entries(THEMES).map(([value, spec]) => ({ value, label: spec.label })),
  panelScaleRange: PANEL_SCALE,
}));

ipcMain.handle('config:set', (_event, partial) => {
  const allowed = {};
  if (typeof partial?.terminal === 'string') allowed.terminal = partial.terminal;
  if (typeof partial?.voice === 'string' && VOICES[partial.voice]) allowed.voice = partial.voice;
  if (typeof partial?.theme === 'string' && THEMES[partial.theme]) allowed.theme = partial.theme;
  if (Number.isFinite(partial?.panelScale)) allowed.panelScale = clampScale(partial.panelScale);
  if (typeof partial?.crt === 'boolean') allowed.crt = partial.crt;
  if (typeof partial?.muted === 'boolean') allowed.muted = partial.muted;
  if (typeof partial?.ttsEnabled === 'boolean') allowed.ttsEnabled = partial.ttsEnabled;
  if (typeof partial?.timbre === 'string') allowed.timbre = partial.timbre;
  for (const key of ['soundVolume', 'voiceVolume']) {
    if (Number.isFinite(partial?.[key])) allowed[key] = Math.min(100, Math.max(0, Math.round(partial[key])));
  }
  if (partial?.typeVolumes && typeof partial.typeVolumes === 'object') {
    allowed.typeVolumes = { ...managerConfig.typeVolumes, ...partial.typeVolumes };
  }
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
  if (allowed.panelScale && overlayMode === 'panel') showOverlay('panel', { focus: true });
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

function removeHooksInstalled() {
  try {
    const settings = readClaudeSettings();
    const next = removeAppHooks(settings);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    writeClaudeSettings(next);
    log('hooks removed on quit');
  } catch (error) {
    log(`removeHooksInstalled failed: ${error}`);
  }
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

// Read once, then forget: a note left by a version that never came back would
// otherwise be spoken on every launch.
function announceUpdateIfJustInstalled() {
  let mark = null;
  try {
    mark = JSON.parse(fs.readFileSync(updateNoticeFile, 'utf8'));
    fs.rmSync(updateNoticeFile, { force: true });
  } catch {
    return;
  }
  if (!shouldAnnounce(mark, app.getVersion()) || !managerConfig.ttsEnabled) return;
  const volume = Math.round((managerConfig.voiceVolume * managerConfig.soundVolume) / 100);
  tts.speak(UPDATE_DONE_PHRASE, { voice: managerConfig.voice, volume });
}

function hydrateRegistry() {
  try {
    registry.hydrate(JSON.parse(fs.readFileSync(sessionsFile, 'utf8')));
    registry.prune();
  } catch {
    // first run or corrupt file — start fresh
  }
}

// Drops the sessions whose terminal was closed: they never send a hook on the
// way out, so without this they linger frozen on their last status.
function reapDeadSessions() {
  registry.reconcileLiveSessions(readLiveSessionIds());
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
  tts.watchDownloads(() => sendState());
  announceUpdateIfJustInstalled();
  ensureHooksInstalled();
  hydrateRegistry();
  reapDeadSessions();
  createWindows();
  socketServer = startSocketServer(socketPath, onHookEvent, log);
  setupTray();
  registry.on('change', sendState);
  registry.on('change', scheduleSessionsSave);
  setInterval(() => registry.prune(), PRUNE_INTERVAL_MS);
  setInterval(reapDeadSessions, LIVENESS_INTERVAL_MS);
  updaterHandle = setupUpdater({ onStatus: onUpdateStatus, log });
});

app.on('window-all-closed', () => {
  // with a tray icon the app lives on with every window hidden
  if (!tray) app.quit();
});

app.on('before-quit', () => {
  // closing for real means the hooks stop firing too — parking in the tray is
  // not closing, so they stay while the app watches from there
  removeHooksInstalled();
  tts.stopSpeaking();
  killPendingClaude();
  stopSocketServer(socketServer, socketPath);
  tray?.destroy();
  tray = null;
});
