import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateRepro, REPRO_COMMAND } from './repro';
import type { Incident } from '../../shared/observability';

let repoRoot: string;

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc_aaaaaa',
  fingerprint: 'aaaaaa',
  kind: 'server-api',
  status: 'open',
  count: 1,
  firstSeen: '2026-07-26T10:00:00.000Z',
  lastSeen: '2026-07-26T10:00:00.000Z',
  title: 'TypeError: boom',
  origin: { file: 'server/x.ts', line: 10, column: 1, functionName: 'run', source: [] },
  error: { name: 'TypeError', message: 'boom', frames: [] },
  trigger: { method: 'POST', path: '/api/execute-test-direct', body: { url: 'https://x.test' }, userId: 7 },
  state: {},
  breadcrumbs: [],
  occurrences: [],
  ...overrides,
});

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-repro-'));
});

afterEach(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

const contentOf = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('generateRepro', () => {
  it('writes a high-confidence supertest reproduction for a server-api incident', async () => {
    const repro = await generateRepro(incident(), repoRoot);

    expect(repro.confidence).toBe('high');
    expect(repro.path).toBe('server/__repro__/inc_aaaaaa.repro.ts');
    expect(repro.command).toBe(REPRO_COMMAND);

    const content = contentOf(repro.path);
    expect(content).toContain("'/api/execute-test-direct'");
    expect(content).toContain('registerRoutes');
    expect(content).toContain('expect(response.status).toBeLessThan(500)');
    expect(content).toContain('inc_aaaaaa');
  });

  it('writes a job reproduction carrying the captured job data', async () => {
    const repro = await generateRepro(
      incident({ kind: 'job', trigger: { jobName: 'execute-plan', jobData: { planId: 'p1' } } }),
      repoRoot,
    );

    expect(repro.confidence).toBe('high');
    expect(contentOf(repro.path)).toContain('"planId": "p1"');
  });

  it('marks a client-runtime reproduction best-effort and puts it under client/', async () => {
    const repro = await generateRepro(
      incident({ kind: 'client-runtime', trigger: { route: '/dashboard', componentStack: '\n    at Toaster' } }),
      repoRoot,
    );

    expect(repro.confidence).toBe('best-effort');
    expect(repro.path).toBe('client/src/__repro__/inc_aaaaaa.repro.ts');
    expect(contentOf(repro.path)).toContain('it.todo');
    expect(contentOf(repro.path)).toContain('at Toaster');
  });

  it('marks a runner reproduction medium and records the failing phase', async () => {
    const repro = await generateRepro(
      incident({ kind: 'runner', trigger: { phase: 'browser-launch', browserType: 'chromium' } }),
      repoRoot,
    );

    expect(repro.confidence).toBe('medium');
    expect(contentOf(repro.path)).toContain('browser-launch');
  });

  /**
   * A recurrence must never discard work: once someone has finished a reproduction by
   * hand, regenerating over it would silently destroy the only artifact that reproduces
   * the bug.
   */
  it('does not overwrite a reproduction that has been edited by hand', async () => {
    const first = await generateRepro(incident(), repoRoot);
    fs.writeFileSync(path.join(repoRoot, first.path), '// hand written\n', 'utf8');

    await generateRepro(incident(), repoRoot);

    expect(contentOf(first.path)).toBe('// hand written\n');
  });

  /**
   * The extension is load-bearing: neither vitest config collects `.repro.ts`, so pending
   * reproductions cannot redden the main suites, and promoting one to a permanent
   * regression test is a rename.
   */
  it('always uses the .repro.ts extension', async () => {
    for (const kind of ['server-api', 'job', 'runner', 'client-runtime'] as const) {
      const repro = await generateRepro(incident({ kind }), repoRoot);
      expect(repro.path.endsWith('.repro.ts')).toBe(true);
    }
  });
});
