// aplay has no volume flag and `say` only takes it inline, so the gain is
// applied to the samples themselves — same result on both systems.
export function applyGain(buffer, volume) {
  const factor = Math.min(1, Math.max(0, volume / 100));
  if (factor === 1) return buffer;
  const dataStart = findDataChunk(buffer);
  if (dataStart < 0) return buffer;
  const out = Buffer.from(buffer);
  for (let offset = dataStart; offset + 1 < out.length; offset += 2) {
    out.writeInt16LE(Math.round(out.readInt16LE(offset) * factor), offset);
  }
  return out;
}

function findDataChunk(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') return -1;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') return offset + 8;
    offset += 8 + size + (size % 2);
  }
  return -1;
}
