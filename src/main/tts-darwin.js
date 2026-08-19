import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  KOKORO_SPEAKER_ID,
  installSherpa,
  isSherpaInstalled,
  sherpaPaths,
} from './sherpa-installer.js';
import { configDir } from './paths.js';
import { log } from './log.js';

const VOICE = 'Luciana';
const sherpaDir = path.join(configDir, 'sherpa');
const neuralSupported = process.arch === 'arm64';
let downloadStarted = false;
let speechProcesses = [];

export function stopSpeaking() {
  for (const child of speechProcesses) {
    try {
      child.kill('SIGKILL');
    } catch {
      // already dead
    }
  }
  speechProcesses = [];
}

function ensureNeuralVoiceInBackground() {
  if (!neuralSupported || downloadStarted || isSherpaInstalled(sherpaDir)) return;
  downloadStarted = true;
  log('sherpa: downloading neural voice…');
  installSherpa(sherpaDir)
    .then(() => {
      log('sherpa: neural voice installed');
      speakNeural('Voz neural instalada. Agora eu falo assim!');
    })
    .catch((error) => {
      downloadStarted = false; // allow a retry on the next speak
      log(`sherpa install failed: ${error}`);
    });
}

// sherpa-onnx has no raw-audio streaming mode, so it renders a wav and
// afplay plays it.
export function speakNeural(text, spawnFn = spawn) {
  const { binary, libDir, model, voices, tokens, dataDir } = sherpaPaths(sherpaDir);
  const wavFile = path.join(os.tmpdir(), 'claude-manager-tts.wav');
  const synth = spawnFn(
    binary,
    [
      `--kokoro-model=${model}`,
      `--kokoro-voices=${voices}`,
      `--kokoro-tokens=${tokens}`,
      `--kokoro-data-dir=${dataDir}`,
      '--kokoro-lang=pt-br',
      `--sid=${KOKORO_SPEAKER_ID}`,
      '--num-threads=4',
      `--output-filename=${wavFile}`,
      text,
    ],
    { env: { ...process.env, DYLD_LIBRARY_PATH: libDir }, stdio: 'ignore' },
  );
  speechProcesses = [synth];
  synth.on('error', (error) => log(`sherpa failed: ${error}`));
  synth.on('exit', (code, signal) => {
    if (code !== 0 || signal) return;
    const player = spawnFn('afplay', [wavFile], { stdio: 'ignore' });
    speechProcesses = [player];
    player.on('error', (error) => log(`afplay failed: ${error}`));
  });
}

function speakWithSay(text, spawnFn, voice = VOICE) {
  const args = voice ? ['-v', voice, '--', text] : ['--', text];
  const child = spawnFn('say', args, { stdio: 'ignore' });
  child.on('error', (error) => log(`say failed: ${error}`));
  if (voice) {
    // retry with the system default voice when the pt-BR one is missing
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null && !signal) speakWithSay(text, spawnFn, null);
    });
  }
  speechProcesses = [child];
}

export function speak(
  text,
  {
    spawnFn = spawn,
    neural = neuralSupported && isSherpaInstalled(sherpaDir),
    ensureFn = ensureNeuralVoiceInBackground,
  } = {},
) {
  if (neural) {
    speakNeural(text, spawnFn);
    return;
  }
  speakWithSay(text, spawnFn);
  ensureFn();
}
