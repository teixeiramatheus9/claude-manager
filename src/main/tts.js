import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_VOICE, VOICES, installVoice, isVoiceInstalled, voicePaths } from './sherpa-installer.js';
import { configDir } from './paths.js';
import { log } from './log.js';

const darwin = process.platform === 'darwin';
const sherpaDir = path.join(configDir, 'sherpa');
const legacyPiperDir = path.join(configDir, 'piper');
const downloading = new Set();
let processes = [];
let onDownloadStatus = () => {};

// The renderer shows a line while a model is on its way.
export function watchDownloads(listener) {
  onDownloadStatus = listener;
}

export function downloadingVoice() {
  return [...downloading][0] ?? null;
}

export function stopSpeaking() {
  for (const child of processes) {
    try {
      child.kill('SIGKILL');
    } catch {
      // already dead
    }
  }
  processes = [];
}

// The system voice covers the gap while a model downloads.
function speakWithSystemVoice(text, spawnFn, useVoiceFlag = true) {
  const [command, args] = darwin
    ? ['say', useVoiceFlag ? ['-v', 'Luciana', '--', text] : ['--', text]]
    : ['spd-say', ['-l', 'pt-BR', '--', text]];
  const child = spawnFn(command, args, { stdio: 'ignore' });
  child.on('error', (error) => log(`${command} failed: ${error}`));
  if (darwin && useVoiceFlag) {
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null && !signal) speakWithSystemVoice(text, spawnFn, false);
    });
  }
  processes = [child];
}

// sherpa-onnx has no raw-audio streaming mode, so it renders a wav and the
// system player plays it.
export function speakNeural(text, voiceId, spawnFn = spawn) {
  const { binary, libDir, args } = voicePaths(sherpaDir, voiceId);
  const wavFile = path.join(os.tmpdir(), 'claude-manager-tts.wav');
  const synth = spawnFn(
    binary,
    [...args, '--num-threads=4', `--output-filename=${wavFile}`, text],
    { env: { ...process.env, DYLD_LIBRARY_PATH: libDir, LD_LIBRARY_PATH: libDir }, stdio: 'ignore' },
  );
  processes = [synth];
  synth.on('error', (error) => log(`sherpa failed: ${error}`));
  synth.on('exit', (code, signal) => {
    if (code !== 0 || signal) return;
    const player = spawnFn(darwin ? 'afplay' : 'aplay', darwin ? [wavFile] : ['-q', wavFile], {
      stdio: 'ignore',
    });
    processes = [player];
    player.on('error', (error) => log(`player failed: ${error}`));
  });
}

function ensureVoiceInBackground(voiceId) {
  if (downloading.has(voiceId) || isVoiceInstalled(sherpaDir, voiceId)) return;
  downloading.add(voiceId);
  onDownloadStatus(voiceId);
  log(`voice: downloading ${voiceId}…`);
  installVoice(sherpaDir, voiceId)
    .then(() => {
      log(`voice: ${voiceId} installed`);
      downloading.delete(voiceId);
      onDownloadStatus(null);
      fs.rmSync(legacyPiperDir, { recursive: true, force: true });
      speakNeural('Voz instalada. Agora eu falo assim!', voiceId);
    })
    .catch((error) => {
      downloading.delete(voiceId); // allow a retry on the next speak
      onDownloadStatus(null);
      log(`voice install failed: ${error}`);
    });
}

export function speak(
  text,
  { voice = DEFAULT_VOICE, spawnFn = spawn, installed = null, ensureFn = ensureVoiceInBackground } = {},
) {
  const voiceId = VOICES[voice] ? voice : DEFAULT_VOICE;
  const ready = installed ?? isVoiceInstalled(sherpaDir, voiceId);
  if (ready) {
    speakNeural(text, voiceId, spawnFn);
    return;
  }
  speakWithSystemVoice(text, spawnFn);
  ensureFn(voiceId);
}
