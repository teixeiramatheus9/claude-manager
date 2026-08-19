import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { installPiper, isPiperInstalled, piperPaths } from '../src/main/piper-installer.js';

function fakeFetch() {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake').buffer };
  };
  return { fetchFn, urls };
}

// fake tar: "extracts" by creating the expected binary
function fakeSpawn(piperDir) {
  return (command, args) => {
    const child = new EventEmitter();
    setTimeout(async () => {
      if (command === 'tar') {
        await mkdir(path.join(piperDir, 'piper'), { recursive: true });
        await writeFile(piperPaths(piperDir).binary, 'fake-binary');
      }
      child.emit('close', 0);
    }, 0);
    return child;
  };
}

describe('piper installer', () => {
  it('downloads the binary archive and both voice files', async () => {
    const piperDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'cm-piper-')), 'piper');
    const { fetchFn, urls } = fakeFetch();
    const installed = await installPiper(piperDir, { fetchFn, spawnFn: fakeSpawn(piperDir) });
    expect(installed).toBe(true);
    expect(urls.some((url) => url.includes('piper_linux_x86_64.tar.gz'))).toBe(true);
    expect(urls.some((url) => url.endsWith('pt_BR-faber-medium.onnx'))).toBe(true);
    expect(urls.some((url) => url.endsWith('pt_BR-faber-medium.onnx.json'))).toBe(true);
    expect(isPiperInstalled(piperDir)).toBe(true);
  });

  it('skips downloads entirely when already installed', async () => {
    const piperDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'cm-piper-')), 'piper');
    const { fetchFn: firstFetch } = fakeFetch();
    await installPiper(piperDir, { fetchFn: firstFetch, spawnFn: fakeSpawn(piperDir) });
    const { fetchFn, urls } = fakeFetch();
    await installPiper(piperDir, { fetchFn, spawnFn: fakeSpawn(piperDir) });
    expect(urls).toHaveLength(0);
  });
});
