// Picks the right release asset for the installed package format and CPU.
const ARCH_TOKENS = {
  deb: { x64: 'amd64', arm64: 'arm64' },
  rpm: { x64: 'x86_64', arm64: 'aarch64' },
};

export function pickPackageAsset(assets, format, arch = 'x64') {
  const suffix = `.${format}`;
  const token = ARCH_TOKENS[format]?.[arch] ?? arch;
  const candidates = (assets ?? []).filter((asset) => asset?.name?.endsWith(suffix));
  return candidates.find((asset) => asset.name.includes(token)) ?? candidates[0] ?? null;
}
