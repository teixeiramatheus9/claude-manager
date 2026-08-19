// The card used to show the manager's invented phrase for a finished task while
// a pending question showed the real text. This turns the assistant's last
// message into the one-balloon-per-chat digest, so both cases read the same.
const DEFAULT_MAX_CHARS = 240;

export function digestMessage(text, maxChars = DEFAULT_MAX_CHARS) {
  const collapsed = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxChars) return collapsed;
  const cut = collapsed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  // a single word longer than the limit has no boundary to fall back on
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
