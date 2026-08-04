import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordIncident, configureIncidents } from './incident';
import { IncidentStore } from './store';
import { serverBreadcrumbs } from './breadcrumbs';

let root: string;
let repoRoot: string;
const logged: { level: string; message: string; meta?: unknown }[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-inc-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-repo-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'server', 'thing.ts'), 'a\nb\nc\nd\ne\nf\ng\n', 'utf8');
  fs.mkdirSync(path.join(repoRoot, 'client', 'src', 'components', 'ui'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'client', 'src', 'components', 'ui', 'toaster.tsx'),
    Array.from({ length: 20 }, (_unused, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
    'utf8',
  );
  logged.length = 0;

  configureIncidents({
    rootDir: root,
    repoRoot,
    logger: { error: (message, meta) => logged.push({ level: 'error', message, meta }) },
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

const errorFrom = (file: string, line: number) => {
  const error = new Error('Cannot read properties of undefined (reading \'selector\')');
  error.stack = `TypeError: ${error.message}\n    at run (${path.join(repoRoot, file)}:${line}:5)`;
  return error;
};

const clientErrorFrom = () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'map')");
  error.name = 'TypeError';
  error.stack = `TypeError: ${error.message}\n    at Toaster (/src/components/ui/toaster.tsx:16:15)`;
  return error;
};

describe('recordIncident', () => {
  it('writes an incident with a resolved origin and returns it', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: { method: 'POST', path: '/api/x' },
      correlationId: 'c-1',
    });

    expect(incident).not.toBeNull();
    expect(incident!.origin?.file).toBe('server/thing.ts');
    expect(incident!.origin?.line).toBe(3);
    expect(incident!.trigger).toMatchObject({ method: 'POST', path: '/api/x' });
    expect(incident!.state).toHaveProperty('nodeVersion');

    const store = new IncidentStore(root);
    expect(await store.read(incident!.id)).not.toBeNull();
  });

  it('logs a line carrying the incident id so the log leads to the file', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: {},
      correlationId: 'c-1',
    });

    expect(logged.some((l) => l.message.includes(incident!.id))).toBe(true);
  });

  it('attaches the breadcrumbs recorded for that correlation id', async () => {
    serverBreadcrumbs.push('c-crumbs', { message: 'loaded settings' });

    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: {},
      correlationId: 'c-crumbs',
    });

    expect(incident!.breadcrumbs).toEqual([{ message: 'loaded settings' }]);
  });

  it('redacts secrets in the trigger', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: { body: { username: 'marco', password: 'hunter2-super-secret' } },
      correlationId: 'c-1',
    });

    expect(JSON.stringify(incident!.trigger)).not.toContain('hunter2-super-secret');
    expect(JSON.stringify(incident!.trigger)).toContain('marco');
  });

  it('redacts secrets from breadcrumbs and the error message in the incident actually written to disk', async () => {
    const secret = 'hunter2-do-not-leak';
    serverBreadcrumbs.push('c-secret', { step: 'auth', password: secret });

    const error = new Error(`login failed for password: ${secret}`);
    error.stack = `Error: ${error.message}\n    at run (${path.join(repoRoot, 'server/thing.ts')}:3:5)`;

    const incident = await recordIncident({
      kind: 'server-api',
      error,
      trigger: {},
      correlationId: 'c-secret',
    });

    expect(incident).not.toBeNull();
    const store = new IncidentStore(root);
    const written = await store.read(incident!.id);

    expect(JSON.stringify(written)).not.toContain(secret);
    // Sanity check the redaction actually ran rather than the field being empty.
    expect(written!.title).toContain('login failed for password');
    expect(written!.breadcrumbs).toEqual([{ step: 'auth', password: '[REDACTED]' }]);
  });

  it('folds occurrences suppressed by the rate limit into the next persisted count', async () => {
    vi.useFakeTimers();
    const error = errorFrom('server/thing.ts', 3);

    const first = await recordIncident({ kind: 'job', error, trigger: {} });
    expect(first).not.toBeNull();

    // Both land inside the 1s gate and would otherwise vanish entirely.
    await recordIncident({ kind: 'job', error, trigger: {} });
    await recordIncident({ kind: 'job', error, trigger: {} });

    vi.advanceTimersByTime(1001);
    const second = await recordIncident({ kind: 'job', error, trigger: {} });

    expect(second).not.toBeNull();
    expect(second!.count).toBe(4);
  });

  it('rate-limits repeats of the same fingerprint within a second', async () => {
    const first = await recordIncident({ kind: 'job', error: errorFrom('server/thing.ts', 3), trigger: {} });
    const second = await recordIncident({ kind: 'job', error: errorFrom('server/thing.ts', 3), trigger: {} });

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const store = new IncidentStore(root);
    expect((await store.read(first!.id))!.count).toBe(1);
  });

  it('never throws when the store cannot be written', async () => {
    configureIncidents({ rootDir: path.join(root, 'nested\0invalid'), repoRoot });

    await expect(
      recordIncident({ kind: 'runner', error: errorFrom('server/thing.ts', 3), trigger: {} }),
    ).resolves.toBeNull();
  });

  it('resolves origin for a client-runtime incident from a Vite-style stack', async () => {
    const incident = await recordIncident({
      kind: 'client-runtime',
      error: clientErrorFrom(),
      trigger: { route: '/dashboard/create-test' },
      correlationId: 'c-1',
    });

    expect(incident!.origin?.file).toBe('client/src/components/ui/toaster.tsx');
    expect(incident!.origin?.line).toBe(16);
    expect(incident!.origin?.unresolved).toBeUndefined();
  });

  it('stamps every incident with the current schema version', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: {},
    });

    expect(incident!.schemaVersion).toBe(1);
  });

  describe('recursion guard', () => {
    it('refuses a nested recordIncident call reachable from within the same recording path', async () => {
      let nestedPromise: Promise<unknown> | undefined;
      configureIncidents({
        rootDir: root,
        repoRoot,
        logger: {
          error: () => {
            // Simulates something inside recordIncident (e.g. the logger transport itself)
            // failing and trying to record its own incident — still on the same async
            // chain as the outer call, so it must be refused, not queued behind it.
            nestedPromise = recordIncident({
              kind: 'runner',
              error: errorFrom('server/thing.ts', 5),
              trigger: {},
            });
          },
        },
      });

      const outer = await recordIncident({
        kind: 'server-api',
        error: errorFrom('server/thing.ts', 3),
        trigger: {},
      });

      expect(outer).not.toBeNull();
      expect(nestedPromise).toBeDefined();
      await expect(nestedPromise).resolves.toBeNull();
    });

    it('records two independent concurrent incidents instead of dropping the second', async () => {
      const [a, b] = await Promise.all([
        recordIncident({ kind: 'server-api', error: errorFrom('server/thing.ts', 3), trigger: {} }),
        recordIncident({ kind: 'job', error: errorFrom('server/thing.ts', 5), trigger: {} }),
      ]);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.id).not.toBe(b!.id);
    });
  });
});

describe('recordIncident reproduction generation', () => {
  it('generates a reproduction alongside the incident', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: { method: 'POST', path: '/api/x', body: {} },
    });

    expect(incident!.repro?.confidence).toBe('high');
    expect(fs.existsSync(path.join(repoRoot, incident!.repro!.path))).toBe(true);
  });
});
