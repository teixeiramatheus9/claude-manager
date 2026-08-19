import { spawn } from 'node:child_process';
import { log } from './log.js';

const VOICE = 'Luciana';

let speech = null;

export function stopSpeaking() {
  if (!speech) return;
  try {
    speech.kill('SIGKILL');
  } catch {
    // already dead
  }
  speech = null;
}

export function speak(text, { spawnFn = spawn, voice = VOICE } = {}) {
  const args = voice ? ['-v', voice, '--', text] : ['--', text];
  const child = spawnFn('say', args, { stdio: 'ignore' });
  child.on('error', (error) => log(`say failed: ${error}`));
  if (voice) {
    // retry with the system default voice when the pt-BR one is missing
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null && !signal) speak(text, { spawnFn, voice: null });
    });
  }
  speech = child;
}
