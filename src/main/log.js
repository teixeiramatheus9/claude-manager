import fs from 'node:fs';
import { configDir, logFile } from './paths.js';

export function log(message) {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging must never break the app
  }
}
