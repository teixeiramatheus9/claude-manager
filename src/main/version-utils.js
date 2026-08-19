// Pure semver-ish comparison (MAJOR.MINOR.PATCH, optional leading "v").
export function isNewerVersion(candidate, current) {
  const parse = (version) =>
    String(version ?? '')
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const [candidateMajor, candidateMinor, candidatePatch] = parse(candidate);
  const [currentMajor, currentMinor, currentPatch] = parse(current);
  if (candidateMajor !== currentMajor) return candidateMajor > currentMajor;
  if (candidateMinor !== currentMinor) return candidateMinor > currentMinor;
  return candidatePatch > currentPatch;
}
