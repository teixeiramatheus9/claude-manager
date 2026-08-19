// CJS on purpose: Electron preload scripts require CommonJS in sandboxed renderers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manager', {
  togglePanel: () => ipcRenderer.send('overlay:toggle-panel'),
  openPanel: () => ipcRenderer.send('overlay:open-panel'),
  closeOverlay: () => ipcRenderer.send('overlay:close'),
  quit: () => ipcRenderer.send('app:quit'),
  panelOpened: () => ipcRenderer.send('panel:opened'),
  removeSession: (sessionId) => ipcRenderer.send('session:remove', sessionId),
  applyUpdate: () => ipcRenderer.send('update:apply'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  focusSession: (sessionId) => ipcRenderer.invoke('warp:focus', sessionId),
  sendReply: (sessionId, text) => ipcRenderer.invoke('warp:reply', { sessionId, text }),
  answerQuestion: (sessionId, optionIndex) =>
    ipcRenderer.invoke('warp:answer', { sessionId, optionIndex }),
  chatWithManager: (text) => ipcRenderer.invoke('manager:chat', text),
  getInboundPolicy: () => ipcRenderer.invoke('inbound:get'),
  setInboundPolicy: (value) => ipcRenderer.invoke('inbound:set', value),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  onTooltip: (callback) => ipcRenderer.on('tooltip', (_event, data) => callback(data)),
  onChime: (callback) => ipcRenderer.on('chime', (_event, data) => callback(data)),
  speak: (text) => ipcRenderer.send('tts:speak', text),
  onBlur: (callback) => ipcRenderer.on('ui:blur', () => callback()),
  onEnv: (callback) => ipcRenderer.on('ui:env', (_event, env) => callback(env)),
  onOverlayMode: (callback) => ipcRenderer.on('overlay:mode', (_event, mode) => callback(mode)),
  onClick: (callback) => ipcRenderer.on('ui:click', () => callback()),
});
