import { describe, expect, it } from 'vitest';
import { elevationCommand } from '../src/main/privileged-exec.js';

const pkexec = { file: 'pkexec', args: ['dnf', 'install', '-y', '/tmp/pkg.rpm'] };

describe('elevationCommand', () => {
  it('runs pkexec directly when the process can still gain privileges', () => {
    expect(
      elevationCommand({ ...pkexec, platform: 'linux', noNewPrivs: false, hasSystemdRun: true }),
    ).toEqual(pkexec);
  });

  it('detours through the systemd user manager once no_new_privs is set', () => {
    expect(
      elevationCommand({ ...pkexec, platform: 'linux', noNewPrivs: true, hasSystemdRun: true }),
    ).toEqual({
      file: 'systemd-run',
      args: [
        '--user',
        '--pipe',
        '--wait',
        '--quiet',
        '--collect',
        'pkexec',
        'dnf',
        'install',
        '-y',
        '/tmp/pkg.rpm',
      ],
    });
  });

  it('keeps pkexec direct when there is no systemd-run to detour through', () => {
    expect(
      elevationCommand({ ...pkexec, platform: 'linux', noNewPrivs: true, hasSystemdRun: false }),
    ).toEqual(pkexec);
  });

  it('never detours off Linux', () => {
    expect(
      elevationCommand({ ...pkexec, platform: 'darwin', noNewPrivs: true, hasSystemdRun: true }),
    ).toEqual(pkexec);
  });
});
