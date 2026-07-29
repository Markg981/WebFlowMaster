import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordRunnerFailure } from './runner';
import { configureIncidents } from '../incident';
import { IncidentStore } from '../store';

let root: string;
// generateRepro writes under repoRoot, not rootDir. Without its own temp directory
// these tests would scatter .repro.ts files across the real working tree.
let reproRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-runner-'));
  reproRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-reporoot-'));
  configureIncidents({ rootDir: root, repoRoot: reproRoot, logger: { error: () => {} } });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(reproRoot, { recursive: true, force: true });
});

/**
 * recordRunnerFailure records fire-and-forget on purpose, so these poll for the artifact.
 * A fixed sleep would be a flake waiting to happen: the write is several real filesystem
 * round-trips and a slow machine will not finish inside any constant.
 */
const waitForIncident = () =>
  vi.waitFor(async () => {
    const store = new IncidentStore(root);
    const [entry] = await store.readIndex();
    expect(entry).toBeDefined();
    const incident = await store.read(entry.id);
    expect(incident).not.toBeNull();
    return incident!;
  }, { timeout: 2000 });

describe('recordRunnerFailure', () => {
  it('records the phase and context', async () => {
    recordRunnerFailure({
      phase: 'browser-launch',
      error: new Error('Failed to launch browser for recording.'),
      context: { browserType: 'chromium', url: 'https://app.test' },
    });

    const incident = await waitForIncident();

    expect(incident.kind).toBe('runner');
    expect(incident.trigger).toMatchObject({ phase: 'browser-launch', browserType: 'chromium' });
  });

  it('accepts a non-Error rejection without throwing', async () => {
    expect(() =>
      recordRunnerFailure({ phase: 'goto', error: 'string failure', context: {} }),
    ).not.toThrow();

    const incident = await waitForIncident();
    expect(incident.title).toContain('string failure');
  });

  it('returns synchronously rather than making the caller wait on disk', () => {
    const startedAt = Date.now();

    recordRunnerFailure({ phase: 'goto', error: new Error('slow'), context: {} });

    // A runner already in trouble must not be further delayed by incident I/O.
    expect(Date.now() - startedAt).toBeLessThan(50);
  });
});
