import { spawn } from 'node:child_process';
import path from 'node:path';
import { installPiper, isPiperInstalled, piperPaths } from './piper-installer.js';
import { configDir } from './paths.js';
import { log } from './log.js';

// Local TTS, offline and token-free. Prefers Piper (neural pt-BR voice);
// falls back to spd-say (robotic) while Piper auto-downloads on first use.
const piperDir = path.join(configDir, 'piper');
const { binary: piperBinary, voice: piperVoice } = piperPaths(piperDir);
const PIPER_SAMPLE_RATE = '22050';
let piperDownloadStarted = false;

function ensurePiperInBackground() {
  if (piperDownloadStarted || isPiperInstalled(piperDir)) return;
  piperDownloadStarted = true;
  log('piper: downloading neural voice…');
  installPiper(piperDir)
    .then(() => {
      log('piper: neural voice installed');
      speakWithPiper('Voz neural instalada. Agora eu falo assim!');
    })
    .catch((error) => {
      piperDownloadStarted = false; // allow a retry on the next speak
      log(`piper install failed: ${error}`);
    });
}

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

function speakWithPiper(text) {
  const piper = spawn(piperBinary, ['--model', piperVoice, '--output-raw'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const player = spawn(
    'aplay',
    ['-q', '-r', PIPER_SAMPLE_RATE, '-f', 'S16_LE', '-t', 'raw', '-c', '1', '-'],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  speechProcesses = [piper, player];
  piper.stdout.pipe(player.stdin);
  piper.on('error', (error) => log(`piper failed: ${error}`));
  player.on('error', (error) => log(`aplay failed: ${error}`));
  piper.stdin.end(text);
}

function spawnDetached(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (error) => log(`${command} failed: ${error}`));
  child.unref();
}

export function speak(text) {
  if (isPiperInstalled(piperDir)) {
    speakWithPiper(text);
  } else {
    spawnDetached('spd-say', ['-l', 'pt-BR', '--', text]);
    ensurePiperInBackground();
  }
}
