import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { apiTests, loadTestRuns, loadTests } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import {
  loadLimits,
  processLoadRunJob,
  recoverLostLoadRuns,
  releaseLoadSlot,
  reserveLoadSlot,
} from './load-runner';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';

vi.mock('./logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

/**
 * A load worker's side of a load-run job (server/load-runner.ts, processLoadRunJob), with the
 * engine stood in: claiming the queued run, the heartbeat while it runs, giving it back when the
 * organization is at its limit, skipping what is no longer queued — and the sweep that ends a run
 * whose worker stopped beating.
 */

let organizationId: number;
let userId: number;
let loadTestId: number;

async function insertRun(columns: Partial<typeof loadTestRuns.$inferInsert> = {}) {
  const id = uuidv4();
  await privilegedDb.insert(loadTestRuns).values({
    id,
    organizationId,
    loadTestId,
    status: 'queued',
    definition: {},
    queuedAt: new Date(),
    ...columns,
  });
  return id;
}

async function runRow(id: string) {
  const [row] = await privilegedDb.select().from(loadTestRuns).where(eq(loadTestRuns.id, id));
  return row;
}

const job = (runId: string) => ({ runId, organizationId, userId });

beforeAll(async () => {
  organizationId = await createTestOrganization('Load Job Org');
  userId = await createTestUser(organizationId, `load-job-${uuidv4().slice(0, 8)}`);
  const [test] = await privilegedDb
    .insert(apiTests)
    .values({ userId, organizationId, name: 'Ping', method: 'GET', url: 'http://127.0.0.1:9/' })
    .returning();
  [{ id: loadTestId }] = await privilegedDb
    .insert(loadTests)
    .values({
      organizationId,
      name: 'Job test',
      steps: [{ apiTestId: test.id }],
      stages: [{ durationSec: 10, targetVus: 1 }],
      createdBy: userId,
    })
    .returning();
});

beforeEach(async () => {
  await privilegedDb.delete(loadTestRuns).where(eq(loadTestRuns.organizationId, organizationId));
});

afterEach(() => {
  delete process.env.LOAD_MAX_RUNS_PER_ORGANIZATION;
  delete process.env.LOAD_WORKER_CONCURRENCY;
  delete process.env.LOAD_MAX_VIRTUAL_USERS;
  delete process.env.LOAD_MAX_DURATION_S;
});

describe('the limits', () => {
  it('are the shipped ones unless the environment says otherwise, by name', () => {
    expect(loadLimits({})).toEqual({
      virtualUsers: 200,
      durationSec: 3600,
      runsPerOrganization: 1,
      runsPerWorker: 1,
    });
    expect(
      loadLimits({
        LOAD_MAX_VIRTUAL_USERS: '1000',
        LOAD_MAX_DURATION_S: '7200',
        LOAD_MAX_RUNS_PER_ORGANIZATION: '3',
        LOAD_WORKER_CONCURRENCY: '0',
      }),
    ).toEqual({ virtualUsers: 1000, durationSec: 7200, runsPerOrganization: 3, runsPerWorker: 0 });
    expect(() => loadLimits({ LOAD_MAX_VIRTUAL_USERS: 'many' })).toThrow(
      /LOAD_MAX_VIRTUAL_USERS must be a whole number of at least 1; got "many"/,
    );
    expect(() => loadLimits({ LOAD_MAX_RUNS_PER_ORGANIZATION: '0' })).toThrow(
      /LOAD_MAX_RUNS_PER_ORGANIZATION/,
    );
  });

  it('give a worker as many slots as LOAD_WORKER_CONCURRENCY', () => {
    process.env.LOAD_WORKER_CONCURRENCY = '2';
    expect(reserveLoadSlot()).toBe(true);
    expect(reserveLoadSlot()).toBe(true);
    expect(reserveLoadSlot()).toBe(false);
    releaseLoadSlot();
    expect(reserveLoadSlot()).toBe(true);
    releaseLoadSlot();
    releaseLoadSlot();
  });
});

describe('processing a load-run job', () => {
  it('claims the queued run for this worker, beats while it runs, and executes it', async () => {
    const runId = await insertRun();
    let seenWhileRunning: typeof loadTestRuns.$inferSelect | undefined;
    const execute = vi.fn(async (id: string, org: number, user: number) => {
      expect([org, user]).toEqual([organizationId, userId]);
      const before = await runRow(id);
      await new Promise((resolve) => setTimeout(resolve, 120));
      seenWhileRunning = await runRow(id);
      expect(seenWhileRunning.heartbeatAt!.getTime()).toBeGreaterThan(
        before.heartbeatAt!.getTime(),
      );
      await runWithTenant(org, () =>
        withTenantTransaction((tx) =>
          tx.update(loadTestRuns).set({ status: 'passed' }).where(eq(loadTestRuns.id, id)),
        ),
      );
    });
    const outcome = await processLoadRunJob(job(runId), {
      execute,
      heartbeatMs: 30,
      workerId: 'worker-a:1',
    });
    expect(outcome).toEqual({ outcome: 'done' });
    expect(execute).toHaveBeenCalledOnce();
    expect(seenWhileRunning).toMatchObject({ status: 'running', workerId: 'worker-a:1' });
    expect((await runRow(runId)).status).toBe('passed');
    // The slot is given back, whatever happened.
    expect(reserveLoadSlot()).toBe(true);
    releaseLoadSlot();
  });

  it('skips a run that is no longer queued, or gone', async () => {
    const execute = vi.fn();
    const cancelled = await insertRun({ status: 'cancelled', cancelRequested: true });
    expect(await processLoadRunJob(job(cancelled), { execute })).toEqual({
      outcome: 'skipped',
      reason: 'the run is cancelled',
    });
    const taken = await insertRun({ status: 'running', workerId: 'worker-b:2' });
    expect(await processLoadRunJob(job(taken), { execute })).toEqual({
      outcome: 'skipped',
      reason: 'the run is running',
    });
    expect((await runRow(taken)).workerId).toBe('worker-b:2');
    expect(await processLoadRunJob(job(uuidv4()), { execute })).toEqual({
      outcome: 'skipped',
      reason: 'the run no longer exists',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('gives the run back for a while when the organization is at its limit', async () => {
    await insertRun({ status: 'running', workerId: 'worker-b:2', heartbeatAt: new Date() });
    const runId = await insertRun();
    const execute = vi.fn();
    expect(await processLoadRunJob(job(runId), { execute, retryInMs: 5_000 })).toEqual({
      outcome: 'deferred',
      retryInMs: 5_000,
    });
    expect((await runRow(runId)).status).toBe('queued');
    expect(execute).not.toHaveBeenCalled();
    // With room for two, it goes.
    process.env.LOAD_MAX_RUNS_PER_ORGANIZATION = '2';
    expect(await processLoadRunJob(job(runId), { execute })).toEqual({ outcome: 'done' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('releases the slot and the heartbeat when the engine throws', async () => {
    const runId = await insertRun();
    await expect(
      processLoadRunJob(job(runId), {
        execute: async () => {
          throw new Error('boom');
        },
        heartbeatMs: 20,
      }),
    ).rejects.toThrow('boom');
    expect(reserveLoadSlot()).toBe(true);
    releaseLoadSlot();
    const beat = (await runRow(runId)).heartbeatAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await runRow(runId)).heartbeatAt!.getTime()).toBe(beat);
  });
});

describe('the worker-lost sweep', () => {
  it('ends only running runs whose heartbeat went quiet', async () => {
    const now = new Date('2026-10-11T10:00:00.000Z');
    const quiet = await insertRun({
      status: 'running',
      startedAt: new Date(now.getTime() - 20 * 60_000),
      heartbeatAt: new Date(now.getTime() - 3 * 60_000),
    });
    const neverBeat = await insertRun({
      status: 'running',
      startedAt: new Date(now.getTime() - 20 * 60_000),
    });
    const alive = await insertRun({
      status: 'running',
      startedAt: new Date(now.getTime() - 20 * 60_000),
      heartbeatAt: new Date(now.getTime() - 10_000),
    });
    const waiting = await insertRun({ startedAt: new Date(now.getTime() - 20 * 60_000) });
    const lost = await runWithTenant(organizationId, () =>
      withTenantTransaction((tx) => recoverLostLoadRuns(tx, { now, staleAfterMs: 120_000 })),
    );
    expect(lost.sort()).toEqual([quiet, neverBeat].sort());
    expect(await runRow(quiet)).toMatchObject({
      status: 'worker_lost',
      error:
        'The worker running this stopped answering (last heard from at 2026-10-11T09:57:00Z). Its results up to then are kept; the run did not finish.',
      finishedAt: now,
    });
    expect((await runRow(neverBeat)).error).toMatch(/last heard from at 2026-10-11T09:40:00Z/);
    expect((await runRow(alive)).status).toBe('running');
    expect((await runRow(waiting)).status).toBe('queued');
    // Swept once: the second sweep finds nothing.
    const again = await runWithTenant(organizationId, () =>
      withTenantTransaction((tx) => recoverLostLoadRuns(tx, { now, staleAfterMs: 120_000 })),
    );
    expect(again).toEqual([]);
    expect(
      await privilegedDb
        .select({ id: loadTestRuns.id })
        .from(loadTestRuns)
        .where(
          and(eq(loadTestRuns.organizationId, organizationId), eq(loadTestRuns.status, 'running')),
        ),
    ).toHaveLength(1);
  });
});
