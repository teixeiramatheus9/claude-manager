import os from 'node:os';
import path from 'node:path';

export const configDir = path.join(os.homedir(), '.config', 'claude-manager');
export const socketPath = path.join(configDir, 'manager.sock');
export const stateFile = path.join(configDir, 'state.json');
export const sessionsFile = path.join(configDir, 'sessions.json');
export const configFile = path.join(configDir, 'config.json');
export const usageFile = path.join(configDir, 'usage.json');
export const logFile = path.join(configDir, 'log');
