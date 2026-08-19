import * as warp from './warp.js';
import * as terminalDarwin from './terminal-darwin.js';
import * as ttsLinux from './tts-linux.js';
import * as ttsDarwin from './tts-darwin.js';

const darwin = process.platform === 'darwin';

export const terminal = darwin ? terminalDarwin : warp;
export const tts = darwin ? ttsDarwin : ttsLinux;
