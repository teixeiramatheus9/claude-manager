import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PIPER_RELEASE_URL =
  'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz';
const VOICE_BASE_URL =
  'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium';
export const VOICE_FILE = 'pt_BR-faber-medium.onnx';

export function piperPaths(piperDir) {
  return {
    binary: path.join(piperDir, 'piper', 'piper'),
    voice: path.join(piperDir, VOICE_FILE),
  };
}

export function isPiperInstalled(piperDir, existsFn = fs.existsSync) {
  const { binary, voice } = piperPaths(piperDir);
  return existsFn(binary) && existsFn(voice);
}

async function download(url, destination, fetchFn) {
  const response = await fetchFn(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function extractTarGz(archive, directory, spawnFn) {
  return new Promise((resolve, reject) => {
    const tar = spawnFn('tar', ['-xzf', archive, '-C', directory], { stdio: 'ignore' });
    tar.on('error', reject);
    tar.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)),
    );
  });
}

// Downloads the Piper binary and the pt-BR voice into piperDir (~66MB total).
// Used by the packaged app the first time TTS is enabled without the voice.
export async function installPiper(piperDir, { fetchFn = fetch, spawnFn = spawn } = {}) {
  fs.mkdirSync(piperDir, { recursive: true });
  const { binary, voice } = piperPaths(piperDir);

  if (!fs.existsSync(binary)) {
    const archive = path.join(piperDir, 'piper.tar.gz');
    await download(PIPER_RELEASE_URL, archive, fetchFn);
    await extractTarGz(archive, piperDir, spawnFn);
    fs.rmSync(archive, { force: true });
  }
  if (!fs.existsSync(voice)) {
    await download(`${VOICE_BASE_URL}/${VOICE_FILE}`, voice, fetchFn);
    await download(`${VOICE_BASE_URL}/${VOICE_FILE}.json`, `${voice}.json`, fetchFn);
  }
  return isPiperInstalled(piperDir);
}
