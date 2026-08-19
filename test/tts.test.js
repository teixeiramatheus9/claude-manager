import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  playerCommand,
  speak,
  speakNeural,
  stopSpeaking,
  systemVoiceCommand,
} from '../src/main/tts.js';
import {
  DEFAULT_VOICE,
  VOICES,
  isVoiceInstalled,
  runtimeName,
  tarBinary,
  voicePaths,
} from '../src/main/sherpa-installer.js';

const darwin = process.platform === 'darwin';

function recorder() {
  const calls = [];
  const children = [];
  const spawnFn = (command, args, opts) => {
    calls.push({ command, args, opts });
    const child = new EventEmitter();
    child.kill = (signal) => {
      child.killed = signal;
    };
    children.push(child);
    return child;
  };
  return { calls, children, spawnFn };
}

describe('runtime and voice resolution', () => {
  it('maps every supported platform+arch to a runtime', () => {
    expect(runtimeName('darwin', 'arm64')).toContain('osx-arm64');
    expect(runtimeName('darwin', 'x64')).toContain('osx-x64');
    expect(runtimeName('linux', 'x64')).toContain('linux-x64');
    expect(runtimeName('linux', 'arm64')).toContain('aarch64');
    expect(runtimeName('sunos', 'x64')).toBeNull();
  });

  it('builds kokoro flags for santa and vits flags for faber', () => {
    const santa = voicePaths('/cfg', 'santa', 'linux', 'x64');
    expect(santa.args.some((a) => a.startsWith('--kokoro-model='))).toBe(true);
    expect(santa.args).toContain('--kokoro-lang=pt-br');
    expect(santa.args).toContain('--sid=44');

    const faber = voicePaths('/cfg', 'faber', 'linux', 'x64');
    expect(faber.args.some((a) => a.startsWith('--vits-model='))).toBe(true);
    expect(faber.args.every((a) => !a.includes('kokoro'))).toBe(true);
  });

  it('pins the OS-bundled bsdtar on win32 and plain tar elsewhere', () => {
    expect(tarBinary('linux', {}, () => true)).toBe('tar');
    expect(tarBinary('win32', { SystemRoot: 'C:\\Windows' }, () => true)).toBe(
      'C:\\Windows\\System32\\tar.exe',
    );
    expect(tarBinary('win32', { SystemRoot: 'C:\\Windows' }, () => false)).toBe('tar');
  });

  it('resolves a win32-x64 runtime with an .exe binary', () => {
    const { binary, libDir } = voicePaths('C:\\cfg\\sherpa', 'faber', 'win32', 'x64');
    expect(binary).toMatch(/sherpa-onnx-offline-tts\.exe$/);
    expect(binary).toContain('win-x64-shared');
    expect(libDir).toContain('win-x64-shared');
  });

  it('still resolves the linux binary without a suffix', () => {
    const { binary } = voicePaths('/cfg/sherpa', 'faber', 'linux', 'x64');
    expect(binary).toMatch(/sherpa-onnx-offline-tts$/);
  });

  it('falls back to the default voice for an unknown id', () => {
    const unknown = voicePaths('/cfg', 'nope', 'linux', 'x64');
    expect(unknown.voiceDir).toContain(VOICES[DEFAULT_VOICE].dirName);
  });

  it('needs binary and model to consider a voice installed', () => {
    expect(isVoiceInstalled('/cfg', 'faber', () => true, 'linux', 'x64')).toBe(true);
    const missingModel = (p) => !p.endsWith('.onnx');
    expect(isVoiceInstalled('/cfg', 'faber', missingModel, 'linux', 'x64')).toBe(false);
    expect(isVoiceInstalled('/cfg', 'faber', () => true, 'sunos', 'x64')).toBe(false);
  });
});

describe('speak', () => {
  it('synthesizes with sherpa and plays the wav when the voice is installed', () => {
    const { calls, children, spawnFn } = recorder();
    speak('olá', { voice: 'faber', spawnFn, installed: true });
    expect(calls[0].command).toContain('sherpa-onnx-offline-tts');
    expect(calls[0].args.at(-1)).toBe('olá');
    expect(calls[0].args.some((a) => a.startsWith('--vits-model='))).toBe(true);
    children[0].emit('exit', 0, null);
    expect(calls[1].command).toBe(playerCommand('x.wav', process.platform)[0]);
    stopSpeaking();
  });

  it('uses the system voice and pulls the model when it is missing', () => {
    const { calls, spawnFn } = recorder();
    let asked = null;
    speak('olá', { voice: 'santa', spawnFn, installed: false, ensureFn: (id) => (asked = id) });
    expect(calls[0].command).toBe(systemVoiceCommand('x', 100, process.platform)[0]);
    expect(asked).toBe('santa');
    stopSpeaking();
  });

  it('does not play anything when the synth was killed', () => {
    const { calls, children, spawnFn } = recorder();
    speak('olá', { voice: 'santa', spawnFn, installed: true });
    stopSpeaking();
    expect(children[0].killed).toBe('SIGKILL');
    children[0].emit('exit', null, 'SIGKILL');
    expect(calls).toHaveLength(1);
  });

  it('exposes the sid only for santa', () => {
    const { calls, spawnFn } = recorder();
    speakNeural('olá', 'santa', spawnFn);
    expect(calls[0].args).toContain('--sid=44');
    stopSpeaking();
  });
});

describe('playerCommand', () => {
  it('darwin uses afplay', () => {
    expect(playerCommand('/tmp/x.wav', 'darwin')).toEqual(['afplay', ['/tmp/x.wav']]);
  });
  it('linux uses aplay -q', () => {
    expect(playerCommand('/tmp/x.wav', 'linux')).toEqual(['aplay', ['-q', '/tmp/x.wav']]);
  });
  it('win32 plays through PowerShell SoundPlayer', () => {
    const [command, args] = playerCommand('C:\\t\\x.wav', 'win32');
    expect(command).toBe('powershell.exe');
    expect(args.at(-1)).toContain("Media.SoundPlayer 'C:\\t\\x.wav'");
    expect(args.at(-1)).toContain('PlaySync()');
  });
});

describe('systemVoiceCommand', () => {
  it('win32 speaks through System.Speech with a pt-BR voice when available', () => {
    const [command, args] = systemVoiceCommand('valeu, irmão!', 80, 'win32');
    expect(command).toBe('powershell.exe');
    const script = args.at(-1);
    expect(script).toContain('System.Speech');
    expect(script).toContain('$s.Volume = 80');
    expect(script).toContain('pt-BR');
    expect(script).toContain("Speak('valeu, irmão!')");
  });
  it('darwin still uses say -v Luciana', () => {
    expect(systemVoiceCommand('oi', 100, 'darwin')).toEqual(['say', ['-v', 'Luciana', '--', 'oi']]);
  });
  it('linux still uses spd-say', () => {
    expect(systemVoiceCommand('oi', 100, 'linux')).toEqual([
      'spd-say',
      ['-l', 'pt-BR', '-i', '100', '--', 'oi'],
    ]);
  });
});
