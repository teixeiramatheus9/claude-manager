import { spawn } from 'node:child_process';

// Parses `claude -p --output-format json` output: the model's text lives in
// `.result` and real token usage in `.usage`.
export function parseCliJson(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const usage = parsed.usage ?? {};
    const tokens = (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
    return { text: typeof parsed.result === 'string' ? parsed.result : '', tokens };
  } catch {
    return null;
  }
}

// Runs one headless prompt on Haiku with the anti-recursion guard set.
// Resolves {text, tokens} or null (spawn failure, timeout, non-zero exit,
// unparseable output) — never rejects.
export function runClaude({ prompt, timeoutMs = 15000, spawnFn = spawn }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawnFn('claude', ['-p', prompt, '--model', 'haiku', '--output-format', 'json'], {
        env: { ...process.env, CLAUDE_MANAGER_INTERNAL: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      finish(null);
      return;
    }

    let stdout = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
      finish(null);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0 ? parseCliJson(stdout) : null);
    });
  });
}
