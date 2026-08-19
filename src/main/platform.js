import * as warp from './warp.js';
import * as terminalDarwin from './terminal-darwin.js';
import * as ttsModule from './tts.js';

const darwin = process.platform === 'darwin';

export const terminal = darwin ? terminalDarwin : warp;
export const tts = ttsModule;
