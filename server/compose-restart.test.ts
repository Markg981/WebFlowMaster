import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { DEFAULT_WORKER_SHUTDOWN_GRACE_MS } from './platform/config';

/**
 * The shipped docker-compose.yml must survive a crash, a reboot and `up -d` during a run: the
 * long-running services restart, reap their children, and the worker gets longer to stop than
 * it waits for its runs (Docker SIGKILLs after 10 s by default, the worker waits 30 s).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = parse(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')) as {
  services: Record<string, Record<string, unknown>>;
};

/** "45s", "1m30s" or "90" (seconds) to milliseconds. */
function durationMs(value: unknown): number {
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  let total = 0;
  for (const m of String(value).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)?/g)) {
    total += Number(m[1]) * units[(m[2] ?? 's') as keyof typeof units];
  }
  return total;
}

describe('docker-compose.yml', () => {
  for (const name of ['api', 'worker']) {
    it(`${name} restarts unless stopped and runs an init process`, () => {
      expect(compose.services[name].restart).toBe('unless-stopped');
      expect(compose.services[name].init).toBe(true);
    });
  }

  it('leaves the one-shot migrate service alone', () => {
    expect(compose.services.migrate.restart).toBe('no');
  });

  it('gives the worker more time to stop than it waits for its runs', () => {
    const grace = durationMs(compose.services.worker.stop_grace_period);
    expect(grace).toBeGreaterThan(DEFAULT_WORKER_SHUTDOWN_GRACE_MS);
  });
});
