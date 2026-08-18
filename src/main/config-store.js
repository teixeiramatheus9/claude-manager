import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  terminal: 'auto',
  tokenBudgetDaily: 100000,
};

export function loadConfig(file) {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
