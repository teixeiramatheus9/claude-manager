// CJS on purpose: Electron preload scripts require CommonJS in sandboxed renderers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manager', {
  setMode: (mode) => ipcRenderer.send('ui:mode', mode),
  panelOpened: () => ipcRenderer.send('panel:opened'),
  dismissMessage: (sessionId) => ipcRenderer.send('message:dismiss', sessionId),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  focusSession: (sessionId) => ipcRenderer.invoke('warp:focus', sessionId),
  sendReply: (sessionId, text) => ipcRenderer.invoke('warp:reply', { sessionId, text }),
  answerQuestion: (sessionId, optionIndex) =>
    ipcRenderer.invoke('warp:answer', { sessionId, optionIndex }),
  chatWithManager: (text) => ipcRenderer.invoke('manager:chat', text),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  onTooltip: (callback) => ipcRenderer.on('tooltip', (_event, data) => callback(data)),
  onChime: (callback) => ipcRenderer.on('chime', (_event, data) => callback(data)),
  speak: (text) => ipcRenderer.send('tts:speak', text),
  onBlur: (callback) => ipcRenderer.on('ui:blur', () => callback()),
  onEnv: (callback) => ipcRenderer.on('ui:env', (_event, env) => callback(env)),
  onFlip: (callback) => ipcRenderer.on('ui:flip', (_event, flipped) => callback(flipped)),
  onClick: (callback) => ipcRenderer.on('ui:click', () => callback()),
});
