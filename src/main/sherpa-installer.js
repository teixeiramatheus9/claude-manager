import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHERPA_VERSION = 'v1.13.6';
const RELEASE_BASE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}`;
const MODELS_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

// One runtime per platform+arch; the mac arm64 build is the only one whose
// asset name carries the onnxruntime version.
const RUNTIMES = {
  'darwin-arm64': `sherpa-onnx-${SHERPA_VERSION}-onnxruntime-1.17.1-osx-arm64-shared`,
  'darwin-x64': `sherpa-onnx-${SHERPA_VERSION}-osx-x64-shared`,
  'linux-x64': `sherpa-onnx-${SHERPA_VERSION}-linux-x64-shared`,
  'linux-arm64': `sherpa-onnx-${SHERPA_VERSION}-linux-aarch64-shared-cpu`,
};

export const VOICES = {
  santa: {
    label: 'Santa (neural, ~350MB)',
    dirName: 'kokoro-multi-lang-v1_0',
    modelFile: 'model.onnx',
    args: (dir) => [
      `--kokoro-model=${path.join(dir, 'model.onnx')}`,
      `--kokoro-voices=${path.join(dir, 'voices.bin')}`,
      `--kokoro-tokens=${path.join(dir, 'tokens.txt')}`,
      `--kokoro-data-dir=${path.join(dir, 'espeak-ng-data')}`,
      '--kokoro-lang=pt-br',
      '--sid=44',
    ],
  },
  faber: {
    label: 'Faber (neural, ~85MB)',
    dirName: 'vits-piper-pt_BR-faber-medium',
    modelFile: 'pt_BR-faber-medium.onnx',
    args: (dir) => [
      `--vits-model=${path.join(dir, 'pt_BR-faber-medium.onnx')}`,
      `--vits-tokens=${path.join(dir, 'tokens.txt')}`,
      `--vits-data-dir=${path.join(dir, 'espeak-ng-data')}`,
    ],
  },
};

export const DEFAULT_VOICE = process.platform === 'darwin' ? 'santa' : 'faber';

export function runtimeName(platform = process.platform, arch = process.arch) {
  return RUNTIMES[`${platform}-${arch}`] ?? null;
}

export function voicePaths(sherpaDir, voiceId, platform = process.platform, arch = process.arch) {
  const voice = VOICES[voiceId] ?? VOICES[DEFAULT_VOICE];
  const runtime = runtimeName(platform, arch);
  const runtimeDir = runtime ? path.join(sherpaDir, runtime) : null;
  const voiceDir = path.join(sherpaDir, voice.dirName);
  return {
    runtimeDir,
    binary: runtimeDir ? path.join(runtimeDir, 'bin', 'sherpa-onnx-offline-tts') : null,
    libDir: runtimeDir ? path.join(runtimeDir, 'lib') : null,
    voiceDir,
    model: path.join(voiceDir, voice.modelFile),
    args: voice.args(voiceDir),
  };
}

export function isVoiceInstalled(sherpaDir, voiceId, existsFn = fs.existsSync, platform, arch) {
  const { binary, model } = voicePaths(sherpaDir, voiceId, platform, arch);
  return Boolean(binary) && existsFn(binary) && existsFn(model);
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

// Downloads the sherpa-onnx runtime (once) and the chosen voice model.
export async function installVoice(sherpaDir, voiceId, { fetchFn = fetch, spawnFn = spawn } = {}) {
  const runtime = runtimeName();
  if (!runtime) throw new Error(`no sherpa build for ${process.platform}-${process.arch}`);
  const voice = VOICES[voiceId] ?? VOICES[DEFAULT_VOICE];
  fs.mkdirSync(sherpaDir, { recursive: true });
  const { binary, model } = voicePaths(sherpaDir, voiceId);

  for (const [target, url, name] of [
    [binary, `${RELEASE_BASE}/${runtime}.tar.bz2`, 'runtime.tar.bz2'],
    [model, `${MODELS_BASE}/${voice.dirName}.tar.bz2`, 'voice.tar.bz2'],
  ]) {
    if (fs.existsSync(target)) continue;
    const archive = path.join(sherpaDir, name);
    await download(url, archive, fetchFn);
    await extractTarBz2(archive, sherpaDir, spawnFn);
    fs.rmSync(archive, { force: true });
  }
  return isVoiceInstalled(sherpaDir, voiceId);
}
