import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withJobIncidents } from './jobs';
import { configureIncidents } from '../incident';
import { IncidentStore } from '../store';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-jobs-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('withJobIncidents', () => {
  it('passes a successful job through untouched', async () => {
    const seen: string[] = [];
    const wrapped = withJobIncidents(async (job: { id: string; name: string; data: unknown }) => {
      seen.push(job.name);
    });

    await wrapped({ id: '1', name: 'execute-plan', data: {} });

    expect(seen).toEqual(['execute-plan']);
    expect(await new IncidentStore(root).readIndex()).toHaveLength(0);
  });

  /**
   * Rethrowing is the point: swallowing here would make BullMQ mark a broken job
   * successful, so it would never retry and never surface.
   */
  it('records an incident and rethrows so BullMQ still fails the job', async () => {
    const wrapped = withJobIncidents(async () => {
      throw new Error('processTestPlanJob exploded');
    });

    await expect(
      wrapped({ id: '9', name: 'execute-plan', data: { planId: 'p1' }, attemptsMade: 2 }),
    ).rejects.toThrow('processTestPlanJob exploded');

    const store = new IncidentStore(root);
    const [entry] = await store.readIndex();
    const incident = await store.read(entry.id);

    expect(incident!.kind).toBe('job');
    expect(incident!.trigger).toMatchObject({
      jobName: 'execute-plan',
      jobData: { planId: 'p1' },
      attemptsMade: 2,
    });
  });

  it('rethrows a non-Error rejection unchanged', async () => {
    const wrapped = withJobIncidents(async () => {
      throw 'string failure';
    });

    await expect(wrapped({ id: '3', name: 'execute-plan', data: {} })).rejects.toBe('string failure');

    const [entry] = await new IncidentStore(root).readIndex();
    expect(entry.title).toContain('string failure');
  });
});
