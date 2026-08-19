import fs from 'node:fs';

// pkexec only elevates when the caller is allowed to gain privileges. Chromium
// launches every process it spawns — app.relaunch() included — with
// PR_SET_NO_NEW_PRIVS, which neutralises the setuid bit, is inherited by every
// descendant and can never be cleared. So an app that relaunched itself once
// (see the --ozone-platform relaunch in index.js) can no longer install its own
// update: pkexec bails out with "pkexec must be setuid root".
//
// systemd's user manager sits outside that lineage. A transient unit it starts
// comes up without the flag, and polkit still resolves the unit to the user's
// active session, so the password prompt behaves exactly the same.
export function elevationCommand({ file, args, platform, noNewPrivs, hasSystemdRun }) {
  if (platform !== 'linux' || !noNewPrivs || !hasSystemdRun) return { file, args };
  return {
    file: 'systemd-run',
    args: ['--user', '--pipe', '--wait', '--quiet', '--collect', file, ...args],
  };
}

export function hasNoNewPrivs() {
  try {
    return /^NoNewPrivs:\s*1$/m.test(fs.readFileSync('/proc/self/status', 'utf8'));
  } catch {
    return false;
  }
}

export function hasSystemdRun() {
  return ['/usr/bin/systemd-run', '/bin/systemd-run'].some((candidate) =>
    fs.existsSync(candidate),
  );
}
