import { describe, expect, it } from 'vitest';
import { applyGain } from '../src/main/wav-gain.js';

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(value, index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const samples = (buffer) => {
  const out = [];
  for (let offset = 44; offset + 1 < buffer.length; offset += 2) out.push(buffer.readInt16LE(offset));
  return out;
};

describe('applyGain', () => {
  it('halves the samples at 50%', () => {
    expect(samples(applyGain(wav([1000, -2000, 30000]), 50))).toEqual([500, -1000, 15000]);
  });

  it('returns the same buffer at full volume', () => {
    const original = wav([1000]);
    expect(applyGain(original, 100)).toBe(original);
  });

  it('silences at 0 and clamps anything above 100', () => {
    expect(samples(applyGain(wav([1000, -1000]), 0))).toEqual([0, 0]);
    expect(samples(applyGain(wav([1000]), 500))).toEqual([1000]);
  });

  it('leaves a buffer that is not a wav alone', () => {
    const notWav = Buffer.from('nada disso');
    expect(applyGain(notWav, 50)).toBe(notWav);
  });
});
