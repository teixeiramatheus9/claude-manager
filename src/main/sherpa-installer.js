import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// macOS neural TTS runs on sherpa-onnx (the official Piper macOS build is
// broken: x86_64 binaries mislabeled as arm64, missing dylibs) with the
// Kokoro multi-lang model, whose pt-BR "santa" voice is speaker id 44.
const SHERPA_DIR_NAME = 'sherpa-onnx-v1.13.6-onnxruntime-1.17.1-osx-arm64-shared';
const SHERPA_RELEASE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.6/${SHERPA_DIR_NAME}.tar.bz2`;
const VOICE_DIR_NAME = 'kokoro-multi-lang-v1_0';
const VOICE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${VOICE_DIR_NAME}.tar.bz2`;

export const KOKORO_SPEAKER_ID = '44';

export function sherpaPaths(sherpaDir) {
  const runtime = path.join(sherpaDir, SHERPA_DIR_NAME);
  const voice = path.join(sherpaDir, VOICE_DIR_NAME);
  return {
    binary: path.join(runtime, 'bin', 'sherpa-onnx-offline-tts'),
    libDir: path.join(runtime, 'lib'),
    model: path.join(voice, 'model.onnx'),
    voices: path.join(voice, 'voices.bin'),
    tokens: path.join(voice, 'tokens.txt'),
    dataDir: path.join(voice, 'espeak-ng-data'),
  };
}

export function isSherpaInstalled(sherpaDir, existsFn = fs.existsSync) {
  const { binary, model, voices, tokens } = sherpaPaths(sherpaDir);
  return existsFn(binary) && existsFn(model) && existsFn(voices) && existsFn(tokens);
}

async function download(url, destination, fetchFn) {
  const response = await fetchFn(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function extractTarBz2(archive, directory, spawnFn) {
  return new Promise((resolve, reject) => {
    const tar = spawnFn('tar', ['-xjf', archive, '-C', directory], { stdio: 'ignore' });
    tar.on('error', reject);
    tar.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)),
    );
  });
}

// Downloads the sherpa-onnx runtime and the Kokoro voice into sherpaDir
// (~350MB total) the first time TTS is used on an arm64 mac.
export async function installSherpa(sherpaDir, { fetchFn = fetch, spawnFn = spawn } = {}) {
  fs.mkdirSync(sherpaDir, { recursive: true });
  const { binary, model } = sherpaPaths(sherpaDir);

  for (const [target, url, name] of [
    [binary, SHERPA_RELEASE_URL, 'runtime.tar.bz2'],
    [model, VOICE_URL, 'voice.tar.bz2'],
  ]) {
    if (fs.existsSync(target)) continue;
    const archive = path.join(sherpaDir, name);
    await download(url, archive, fetchFn);
    await extractTarBz2(archive, sherpaDir, spawnFn);
    fs.rmSync(archive, { force: true });
  }
  return isSherpaInstalled(sherpaDir);
}
