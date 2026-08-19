import * as warp from './warp.js';
import * as ttsLinux from './tts-linux.js';
import * as ttsDarwin from './tts-darwin.js';

const darwin = process.platform === 'darwin';

export const terminal = warp;
export const tts = darwin ? ttsDarwin : ttsLinux;
