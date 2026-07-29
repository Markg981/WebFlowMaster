import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { configureIncidents, recordIncident } from './incident';
import { incidentErrorHandler } from './taps/express';
import { IncidentStore } from './store';

/**
 * The acceptance test for the whole mechanism.
 *
 * Everything else in this directory tests a part. This asks the only question that
 * matters: when a real failure happens, does the artifact left behind contain enough to
 * find it, understand it and reproduce it — without anyone describing the bug?
 */

let root: string;
let repoRoot: string;

const BROKEN_SOURCE = [
  'export function readSelector(step: { targetElement?: { selector: string } }) {',
  '  // The bug: targetElement is optional but dereferenced unconditionally.',
  '  return step.targetElement.selector;',
  '}',
  '',
].join('\n');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-loop-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-looprepo-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'server', 'broken.ts'), BROKEN_SOURCE, 'utf8');
  configureIncidents({ rootDir: root, repoRoot, logger: { error: () => {} } });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

const brokenError = () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'selector')");
  error.stack = `TypeError: ${error.message}\n    at readSelector (${path.join(repoRoot, 'server', 'broken.ts')}:3:26)`;
  return error;
};

describe('the incident loop', () => {
  it('turns an unhandled API error into a complete, actionable artifact', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = { id: 7 };
      next();
    });
    app.post('/api/execute-test-direct', () => {
      throw brokenError();
    });
    app.use(incidentErrorHandler({ error: () => {} }));

    await request(app)
      .post('/api/execute-test-direct')
      .send({ url: 'https://app.test', sequence: [{ id: 'step-1', action: { id: 'click' } }] });

    // The tap records fire-and-forget, so poll rather than assume the write has landed.
    const store = new IncidentStore(root);
    const incident = await vi.waitFor(async () => {
      const index = await store.readIndex();
      expect(index).toHaveLength(1);
      expect(index[0].title).toContain('selector');
      const found = await store.read(index[0].id);
      expect(found).not.toBeNull();
      return found!;
    }, { timeout: 2000 });

    // 1. Where it broke — with the code in hand, so nothing has to be looked up.
    expect(incident.origin?.file).toBe('server/broken.ts');
    expect(incident.origin?.line).toBe(3);
    expect(incident.origin?.source.join('\n')).toContain('return step.targetElement.selector;');

    // 2. What caused it.
    expect(incident.trigger).toMatchObject({
      method: 'POST',
      path: '/api/execute-test-direct',
      body: { url: 'https://app.test' },
      userId: 7,
    });

    // 3. Which code produced it — a line number means nothing without this.
    expect(incident.state).toHaveProperty('nodeVersion');
    expect(incident.state).toHaveProperty('gitCommit');

    // 4. A reproduction on disk, runnable, with its confidence declared.
    expect(incident.repro?.confidence).toBe('high');
    const reproFile = path.join(repoRoot, incident.repro!.path);
    expect(fs.existsSync(reproFile)).toBe(true);
    expect(fs.readFileSync(reproFile, 'utf8')).toContain('/api/execute-test-direct');
  });

  it('collapses a storm of the same failure into one artifact', async () => {
    for (let i = 0; i < 20; i++) {
      await recordIncident({ kind: 'server-api', error: brokenError(), trigger: { attempt: i } });
    }

    const index = await new IncidentStore(root).readIndex();
    expect(index).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, 'incidents'))).toHaveLength(1);
  });

  /**
   * The index is the entry point: an agent reads it first and decides what to open. If it
   * did not carry the reproduction path and confidence, every triage would mean opening
   * every artifact.
   */
  it('makes the index alone enough to triage from', async () => {
    await recordIncident({
      kind: 'server-api',
      error: brokenError(),
      trigger: { method: 'POST', path: '/api/x' },
    });

    const [entry] = await new IncidentStore(root).readIndex();

    expect(entry).toMatchObject({
      kind: 'server-api',
      status: 'open',
      count: 1,
      reproConfidence: 'high',
    });
    expect(entry.title).toContain('selector');
    expect(entry.reproPath).toMatch(/\.repro\.ts$/);
    expect(entry.file).toBe(`incidents/${entry.id}.json`);
  });

  /**
   * A trigger carries whatever the caller was sent, which on this product routinely
   * includes credentials for the system under test.
   */
  it('never writes a secret into the artifact', async () => {
    await recordIncident({
      kind: 'server-api',
      error: brokenError(),
      trigger: {
        method: 'POST',
        path: '/api/login',
        body: { username: 'marco', password: 'hunter2-super-secret', access_token: 'tok-abc' },
      },
    });

    const [entry] = await new IncidentStore(root).readIndex();
    const raw = fs.readFileSync(path.join(root, 'incidents', `${entry.id}.json`), 'utf8');

    expect(raw).not.toContain('hunter2-super-secret');
    expect(raw).not.toContain('tok-abc');
    expect(raw).toContain('marco'); // non-secrets survive, or the artifact is useless
  });
});
