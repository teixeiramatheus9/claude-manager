import * as warp from './warp.js';
import * as terminalDarwin from './terminal-darwin.js';
import * as terminalWin32 from './terminal-win32.js';
import * as ttsModule from './tts.js';

const platformTerminal =
  process.platform === 'darwin'
    ? terminalDarwin
    : process.platform === 'win32'
      ? terminalWin32
      : warp;

export const terminal = platformTerminal;
export const tts = ttsModule;
