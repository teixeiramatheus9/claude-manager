import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { managerSocketPath } from '../src/main/paths.js';

describe('managerSocketPath', () => {
  it('uses a unix socket file under configDir off Windows', () => {
    expect(managerSocketPath('linux', '/home/u/.config/claude-manager', 'u')).toBe(
      path.join('/home/u/.config/claude-manager', 'manager.sock'),
    );
    expect(managerSocketPath('darwin', '/Users/u/.config/claude-manager', 'u')).toBe(
      path.join('/Users/u/.config/claude-manager', 'manager.sock'),
    );
  });

  it('uses a per-user named pipe on win32', () => {
    expect(managerSocketPath('win32', 'C:\\ignored', 'alexs')).toBe(
      '\\\\.\\pipe\\claude-manager-alexs',
    );
  });

  it('sanitizes exotic usernames for the pipe name', () => {
    expect(managerSocketPath('win32', 'C:\\ignored', 'John Smith Jr.')).toBe(
      '\\\\.\\pipe\\claude-manager-John-Smith-Jr-',
    );
  });
});
