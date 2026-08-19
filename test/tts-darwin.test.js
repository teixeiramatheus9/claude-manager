import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { speak, stopSpeaking } from '../src/main/tts-darwin.js';
import { sherpaPaths, isSherpaInstalled } from '../src/main/sherpa-installer.js';

function fakeChild() {
  const child = new EventEmitter();
  child.killed = null;
  child.kill = (signal) => {
    child.killed = signal;
  };
  return child;
}

function recorder() {
  const calls = [];
  const children = [];
  const spawnFn = (command, args, opts) => {
    calls.push({ command, args, opts });
    const child = fakeChild();
    children.push(child);
    return child;
  };
  return { calls, children, spawnFn };
}

const noEnsure = () => {};

describe('speak with say (fallback)', () => {
  it('speaks with the pt-BR voice and kicks the neural download', () => {
    const { calls, spawnFn } = recorder();
    let ensured = false;
    speak('olá', { spawnFn, neural: false, ensureFn: () => (ensured = true) });
    expect(calls[0].command).toBe('say');
    expect(calls[0].args).toEqual(['-v', 'Luciana', '--', 'olá']);
    expect(ensured).toBe(true);
    stopSpeaking();
  });

  it('falls back to the default voice when the pt-BR one fails', () => {
    const { calls, children, spawnFn } = recorder();
    speak('olá', { spawnFn, neural: false, ensureFn: noEnsure });
    children[0].emit('exit', 1, null);
    expect(calls[1].args).toEqual(['--', 'olá']);
    stopSpeaking();
  });

  it('does not retry when the speech was killed', () => {
    const { calls, children, spawnFn } = recorder();
    speak('olá', { spawnFn, neural: false, ensureFn: noEnsure });
    stopSpeaking();
    expect(children[0].killed).toBe('SIGKILL');
    children[0].emit('exit', null, 'SIGKILL');
    expect(calls).toHaveLength(1);
  });
});

describe('speak with the neural voice', () => {
  it('renders a wav with sherpa and plays it with afplay', () => {
    const { calls, children, spawnFn } = recorder();
    speak('olá', { spawnFn, neural: true });
    expect(calls[0].command).toContain('sherpa-onnx-offline-tts');
    expect(calls[0].args.at(-1)).toBe('olá');
    expect(calls[0].args).toContain('--kokoro-lang=pt-br');
    expect(calls[0].args).toContain('--sid=44');
    expect(calls[0].opts.env.DYLD_LIBRARY_PATH).toContain('sherpa');
    children[0].emit('exit', 0, null);
    expect(calls[1].command).toBe('afplay');
    stopSpeaking();
  });

  it('does not play anything when the synth was killed', () => {
    const { calls, children, spawnFn } = recorder();
    speak('olá', { spawnFn, neural: true });
    stopSpeaking();
    children[0].emit('exit', null, 'SIGKILL');
    expect(calls).toHaveLength(1);
  });
});

describe('sherpa-installer paths', () => {
  it('resolves binary, model and tokens under the sherpa dir', () => {
    const paths = sherpaPaths('/cfg/sherpa');
    expect(paths.binary).toContain('/cfg/sherpa/');
    expect(paths.binary).toContain('sherpa-onnx-offline-tts');
    expect(paths.model).toContain('kokoro-multi-lang-v1_0/model.onnx');
    expect(paths.voices).toContain('voices.bin');
    expect(paths.dataDir).toContain('espeak-ng-data');
  });

  it('is installed only when binary, model and tokens exist', () => {
    expect(isSherpaInstalled('/cfg', () => true)).toBe(true);
    expect(isSherpaInstalled('/cfg', (p) => !p.endsWith('tokens.txt'))).toBe(false);
  });
});
