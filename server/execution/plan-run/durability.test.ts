import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { and, asc, eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import logger from '../../platform/logger';
import { runWithTenant } from '../../platform/middleware/tenancy';
import {
  executionUnitAttempts,
  executionUnits,
  reportTestCaseResults,
  runWorkItems,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
  type InsertReportTestCaseResult,
} from '@shared/schema';
import { createTestOrganization } from '../../tests/factories';
import {
  claimWorkItem,
  finishWorkItem,
  keepClaim,
  registerShardDispatcher,
  renewClaim,
  writeWorkItems,
  type WorkClaim,
} from '../../runtime/run-shards';
import {
  beginAttempt,
  finishAttempt,
  writeManifest,
  accountFor,
  describeMissing,
} from '../execution-units';
import { claimFence, OwnershipLostError, runFence } from './fence';
import { saveReportEntry } from './report-entry';
import { verdictOf, tallyResults } from './finalize';
import type { ExecutionSnapshot } from '../execution-snapshot';

/**
 * Fencing, safe recovery and authoritative completeness (audit C08 and C02, lot P11).
 *
 * A work item's claim was a name and a heartbeat: a worker that stalled past the stale limit had
 * its item taken by another and, on waking, still wrote the unit's result over the new owner's.
 * Each case below is one way that happened, or one place a worker can die: after the application
 * saw its clicks, after its result was written, before it said so, while its evidence was being
 * published. Whatever happens, an owner whose claim is gone cannot change the verdict or the
 * evidence; what cannot be known is said to be indeterminate, never green; and nothing is run
 * twice against the application unless the plan said it may be.
 */

const executeTestSequence = vi.fn();
const notifyRunFinished = vi.fn();

vi.mock('../../web/playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('../../runtime/precondition-runner', () => ({
  runPreconditions: async () => ({ ok: true, steps: [] }),
}));
vi.mock('./after-run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./after-run')>()),
  notifyRunFinished: (...args: any[]) => notifyRunFinished(...args),
}));

const { processTestPlanJob } = await import('../test-execution-service');

let organizationId: number;
let userId: number;
let planId: string;

const passed = {
  success: true,
  steps: [{ name: 'Click', type: 'click', status: 'passed' }],
  duration: 5,
};
const inTenant = <T>(fn: () => Promise<T>) => runWithTenant(organizationId, fn);
const snapshot = {} as ExecutionSnapshot;

async function seedPlan(columns: Record<string, unknown> = {}, testCount = 2) {
  planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Fenced', userId, organizationId, ...columns } as any);
  for (let i = 1; i <= testCount; i++) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({
        userId,
        organizationId,
        name: `Test ${i}`,
        url: `https://example.test/${i}`,
        sequence: [],
        elements: [],
      })
      .returning();
    await privilegedDb
      .insert(testPlanSelectedTests)
      .values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
  }
}

const unitId = (n: number) => `u_${String(n).padStart(24, '0')}`;
const coordinates = (n: number) => ({
  testType: 'ui' as const,
  testId: n,
  occurrence: 0,
  browser: null,
  locale: null,
  device: null,
  bddRow: null,
});

/** A live run with a manifest of `units` and one work item per entry of `items` (unit numbers). */
async function seedRun(items: number[][]): Promise<string> {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'running',
    triggeredBy: 'manual',
  } as any);
  const units = items.flat();
  await inTenant(async () => {
    await writeManifest(
      executionId,
      organizationId,
      units.map((n, position) => ({
        unitId: unitId(n),
        position,
        coordinates: coordinates(n),
        state: 'planned' as const,
        reason: null,
      })),
    );
    await writeWorkItems(
      executionId,
      organizationId,
      items.map((group, i) => ({
        key: `item-${i}`,
        unit: { units: group.map((n) => ({ link: 0, unitId: unitId(n) })), captured: {} },
      })),
    );
  });
  return executionId;
}

const entryFor = (executionId: string, n: number, attempt: number | null, status = 'Passed') =>
  ({
    id: uuidv4(),
    organizationId,
    testPlanExecutionId: executionId,
    testType: 'ui',
    testName: `Test ${n}`,
    status,
    executionUnitId: unitId(n),
    unitAttempt: attempt,
    startedAt: new Date(),
    completedAt: new Date(),
  }) as InsertReportTestCaseResult;

/** The claim's lease ends now, by the database's clock: the worker holding it has gone quiet. */
const expire = (executionId: string, key: string) =>
  privilegedDb
    .update(runWorkItems)
    .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
    .where(and(eq(runWorkItems.executionId, executionId), eq(runWorkItems.key, key)));

const resultsOf = (executionId: string) =>
  privilegedDb
    .select()
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
const attemptsOf = (executionId: string) =>
  privilegedDb
    .select()
    .from(executionUnitAttempts)
    .where(eq(executionUnitAttempts.executionId, executionId))
    .orderBy(asc(executionUnitAttempts.attempt));
const itemOf = async (executionId: string, key = 'item-0') =>
  (
    await privilegedDb
      .select()
      .from(runWorkItems)
      .where(and(eq(runWorkItems.executionId, executionId), eq(runWorkItems.key, key)))
  )[0];
const unitsOf = (executionId: string) =>
  privilegedDb
    .select()
    .from(executionUnits)
    .where(eq(executionUnits.executionId, executionId))
    .orderBy(asc(executionUnits.position));

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(runWorkItems);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(users);
  organizationId = await createTestOrganization('Fencing Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `fence-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;
  executeTestSequence.mockReset();
  executeTestSequence.mockImplementation(async () => passed);
  notifyRunFinished.mockReset();
  await seedPlan();
});

afterEach(async () => {
  registerShardDispatcher(null);
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('two owners of the same unit, one after the other', () => {
  it('admits the second owner and refuses every late write of the first', async () => {
    const executionId = await seedRun([[1]]);
    // The first owner claims the unit and starts its try: the application sees its clicks.
    const first = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    const firstTry = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(first)),
    );
    // It stalls past its lease; the plan allows a replay, so a second worker takes the unit.
    await expire(executionId, first.workItemKey);
    const second = (await inTenant(() =>
      claimWorkItem(executionId, 'worker-b', { policy: 'replay' }),
    ))!;
    expect(second).toMatchObject({ workItemKey: first.workItemKey, epoch: first.epoch + 1 });
    const secondTry = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(second)),
    );
    await inTenant(() =>
      saveReportEntry(logger, snapshot, entryFor(executionId, 1, secondTry.attempt), {
        fence: claimFence(second),
        deciding: {
          ref: secondTry,
          status: 'passed',
          record: { evidence: { screenshotUrl: '/results/b.png' } },
        },
        onAdmitted: async (tx) => {
          const { completeWorkItem } = await import('../../runtime/run-shards');
          await completeWorkItem(tx, second, { legacy: [], failures: [] });
        },
      }),
    );

    // The first owner wakes and writes, in every way it could.
    const late = entryFor(executionId, 1, firstTry.attempt, 'Failed');
    await expect(
      inTenant(() =>
        saveReportEntry(logger, snapshot, late, {
          fence: claimFence(first),
          deciding: {
            ref: firstTry,
            status: 'failed',
            record: { evidence: { screenshotUrl: '/results/a.png' } },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    await expect(
      inTenant(() =>
        finishAttempt(
          firstTry,
          'failed',
          { evidence: { screenshotUrl: '/results/a.png' } },
          { fence: claimFence(first) },
        ),
      ),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    await expect(
      inTenant(() => beginAttempt({ executionId, unitId: unitId(1) }, claimFence(first))),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    expect(await inTenant(() => finishWorkItem(first, { legacy: [], failures: ['late'] }))).toBe(
      false,
    );
    expect(await inTenant(() => renewClaim(first))).toBe(false);

    // One result, the second owner's; its attempt carries the evidence, the first's none.
    const results = await resultsOf(executionId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'Passed', unitAttempt: secondTry.attempt });
    const attempts = await attemptsOf(executionId);
    expect(
      attempts.map((a) => [a.attempt, a.state, a.claimEpoch, a.evidence?.screenshotUrl ?? null]),
    ).toEqual([
      [1, 'abandoned', first.epoch, null],
      [2, 'finished', second.epoch, '/results/b.png'],
    ]);
    expect((await itemOf(executionId)).state).toBe('done');
  });

  it('gives a stalled claim to nobody by default: it ends indeterminate, and is not run again', async () => {
    const executionId = await seedRun([[1], [2]]);
    const first = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    await inTenant(() => beginAttempt({ executionId, unitId: unitId(1) }, claimFence(first)));
    await expire(executionId, first.workItemKey);

    // The next claim skips past it — after ending it — to the other item.
    const next = (await inTenant(() => claimWorkItem(executionId, 'worker-b')))!;
    expect(next.workItemKey).toBe('item-1');
    expect(await inTenant(() => claimWorkItem(executionId, 'worker-c'))).toBeNull();
    const item = await itemOf(executionId);
    expect(item).toMatchObject({ state: 'indeterminate', epoch: first.epoch });
    expect(item.error).toMatch(/not run again/);
    expect((await unitsOf(executionId))[0].state).toBe('indeterminate');
    expect((await attemptsOf(executionId))[0].state).toBe('abandoned');
  });

  it('takes a stalled claim back when nothing was tried under it: nothing reached the application', async () => {
    const executionId = await seedRun([[1]]);
    const first = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    await expire(executionId, first.workItemKey);
    const second = (await inTenant(() => claimWorkItem(executionId, 'worker-b')))!;
    expect(second.epoch).toBe(first.epoch + 1);
  });
});

describe('a lease that ran out', () => {
  it('refuses writes even when nobody has taken the item since', async () => {
    const executionId = await seedRun([[1]]);
    const claim = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    const attempt = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(claim)),
    );
    await expire(executionId, claim.workItemKey);

    await expect(
      inTenant(() =>
        saveReportEntry(logger, snapshot, entryFor(executionId, 1, attempt.attempt), {
          fence: claimFence(claim),
          deciding: { ref: attempt, status: 'passed', record: {} },
        }),
      ),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    // Not renewed after the fact, and not finished either.
    expect(await inTenant(() => renewClaim(claim))).toBe(false);
    expect(await inTenant(() => finishWorkItem(claim, { legacy: [], failures: [] }))).toBe(false);
    expect(await resultsOf(executionId)).toHaveLength(0);
    expect((await itemOf(executionId)).state).toBe('claimed');
  });

  it('refuses a result that races a refused finish: neither is written', async () => {
    const executionId = await seedRun([[1]]);
    const claim = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    const attempt = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(claim)),
    );
    await expire(executionId, claim.workItemKey);
    const [finished, saved] = await Promise.allSettled([
      inTenant(() => finishWorkItem(claim, { legacy: [], failures: [] })),
      inTenant(() =>
        saveReportEntry(logger, snapshot, entryFor(executionId, 1, attempt.attempt), {
          fence: claimFence(claim),
          deciding: { ref: attempt, status: 'passed', record: {} },
        }),
      ),
    ]);
    expect(finished).toEqual({ status: 'fulfilled', value: false });
    expect(saved.status).toBe('rejected');
    expect(await resultsOf(executionId)).toHaveLength(0);
  });

  it('refuses the writes of a run the recovery sweep already ended', async () => {
    const executionId = await seedRun([[1]]);
    await privilegedDb
      .update(testPlanExecutions)
      .set({ status: 'error', failureCode: 'worker_lost' })
      .where(eq(testPlanExecutions.id, executionId));
    await expect(
      inTenant(() =>
        saveReportEntry(logger, snapshot, entryFor(executionId, 1, null), {
          fence: runFence(executionId),
        }),
      ),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    expect(await resultsOf(executionId)).toHaveLength(0);
  });
});

describe('keeping a lease', () => {
  const claim = (leaseMs: number): WorkClaim => ({
    executionId: 'run',
    workItemKey: 'item-0',
    owner: 'me',
    epoch: 1,
    unit: { units: [], captured: {} },
    leaseMs,
    askedAt: performance.now(),
  });

  it('stops the work before the lease can end when renewals do not answer', async () => {
    const started = performance.now();
    // Every renewal hangs: a heartbeat that times out is not a confirmed renewal.
    const keeper = keepClaim(claim(400), {
      heartbeatMs: 40,
      marginMs: 150,
      renew: () => new Promise<boolean>(() => undefined),
    });
    await new Promise<void>((resolve) => keeper.signal.addEventListener('abort', () => resolve()));
    const elapsed = performance.now() - started;
    keeper.stop();
    expect(keeper.signal.reason).toBeInstanceOf(OwnershipLostError);
    expect((keeper.signal.reason as Error).message).toMatch(/could not confirm in time/);
    // Before the lease less its margin, never after the lease.
    expect(elapsed).toBeLessThan(400);
  });

  it('stops at once when a renewal updates nothing', async () => {
    const keeper = keepClaim(claim(10_000), {
      heartbeatMs: 20,
      marginMs: 1_000,
      renew: async () => false,
    });
    await new Promise<void>((resolve) => keeper.signal.addEventListener('abort', () => resolve()));
    keeper.stop();
    expect((keeper.signal.reason as Error).message).toMatch(/taken over or ended/);
  });

  it('keeps going while renewals are confirmed, and counts from when each was asked for', async () => {
    let renewals = 0;
    const keeper = keepClaim(claim(200), {
      heartbeatMs: 30,
      marginMs: 50,
      renew: async () => {
        renewals += 1;
        return true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const aborted = keeper.signal.aborted;
    keeper.stop();
    expect(aborted).toBe(false);
    expect(renewals).toBeGreaterThan(5);
  });
});

describe('where a worker can die', () => {
  it('after the application saw its clicks, before anything was written: indeterminate, not replayed', async () => {
    const executionId = await seedRun([[1]]);
    const claim = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    await inTenant(() => beginAttempt({ executionId, unitId: unitId(1) }, claimFence(claim)));
    // …the test ran against the application here, and the worker died.
    await expire(executionId, claim.workItemKey);
    expect(await inTenant(() => claimWorkItem(executionId, 'worker-b'))).toBeNull();
    const units = await unitsOf(executionId);
    const account = accountFor(units, await resultsOf(executionId));
    expect(account).toMatchObject({ expected: 1, recorded: 0, indeterminate: 1, missing: 1 });
    expect(describeMissing(account)).toMatch(/1 indeterminate/);
  });

  it('after a chained lane wrote its first result, before the rest: the first stays, the item is not resumed', async () => {
    const executionId = await seedRun([[1, 2]]);
    const claim = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    const firstTry = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(claim)),
    );
    await inTenant(() =>
      saveReportEntry(logger, snapshot, entryFor(executionId, 1, firstTry.attempt), {
        fence: claimFence(claim),
        deciding: { ref: firstTry, status: 'passed', record: {} },
      }),
    );
    // The first result is admitted; the item is not complete with it.
    expect((await itemOf(executionId)).state).toBe('claimed');
    await inTenant(() => beginAttempt({ executionId, unitId: unitId(2) }, claimFence(claim)));
    await expire(executionId, claim.workItemKey);
    // Even with replay allowed: a chained lane lost its captured values with the worker.
    expect(
      await inTenant(() => claimWorkItem(executionId, 'worker-b', { policy: 'replay' })),
    ).toBeNull();
    expect((await unitsOf(executionId)).map((u) => u.state)).toEqual(['recorded', 'indeterminate']);
    expect(await resultsOf(executionId)).toHaveLength(1);
  });

  it('after its last result was written, before it said so: the item was completed with it', async () => {
    const executionId = await seedRun([[1]]);
    const claim = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    const attempt = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(claim)),
    );
    const { completeWorkItem } = await import('../../runtime/run-shards');
    await inTenant(() =>
      saveReportEntry(logger, snapshot, entryFor(executionId, 1, attempt.attempt), {
        fence: claimFence(claim),
        deciding: { ref: attempt, status: 'passed', record: {} },
        onAdmitted: (tx) =>
          completeWorkItem(tx, claim, { legacy: [], failures: [] }).then(() => undefined),
      }),
    );
    // …and the worker died before its acknowledgement. Nothing is left to reclaim or repeat.
    await expire(executionId, claim.workItemKey);
    expect((await itemOf(executionId)).state).toBe('done');
    expect(
      await inTenant(() => claimWorkItem(executionId, 'worker-b', { policy: 'replay' })),
    ).toBeNull();
    expect(await resultsOf(executionId)).toHaveLength(1);
  });

  it('while publishing its evidence: the files are not confirmed evidence of anything', async () => {
    const executionId = await seedRun([[1]]);
    const claim = (await inTenant(() => claimWorkItem(executionId, 'worker-a')))!;
    const attempt = await inTenant(() =>
      beginAttempt({ executionId, unitId: unitId(1) }, claimFence(claim)),
    );
    // Its screenshot reached storage; the worker died before the attempt was admitted with it.
    const dir = path.resolve(
      process.cwd(),
      'results',
      planId,
      executionId,
      'units',
      unitId(1),
      'attempt_1',
    );
    await fs.outputFile(path.join(dir, 'final.png'), 'png');
    await expire(executionId, claim.workItemKey);
    await inTenant(() => claimWorkItem(executionId, 'worker-b'));
    const [row] = await attemptsOf(executionId);
    expect(row).toMatchObject({ attempt: attempt.attempt, state: 'abandoned', evidence: null });
    expect(await resultsOf(executionId)).toHaveLength(0);
  });
});

describe('the verdict, from the manifest', () => {
  it('tells absent, failed, excluded and manual units apart, and needs every expected one', () => {
    const units = [1, 2, 3, 4, 5, 6].map((n) => ({
      unitId: unitId(n),
      state: n === 5 ? 'indeterminate' : n === 6 ? 'not_startable' : 'recorded',
    })) as any;
    const rows = [
      { executionUnitId: unitId(1), status: 'Failed' },
      { executionUnitId: unitId(2), status: 'Skipped' },
      { executionUnitId: unitId(3), status: 'Pending' },
    ] as any;
    expect(accountFor(units, rows)).toEqual({
      expected: 6,
      recorded: 3,
      excluded: 1,
      manual: 1,
      absent: 1,
      indeterminate: 1,
      notStartable: 1,
      missing: 3,
    });
    // Green rows and an incomplete manifest are not green.
    const allPassed = tallyResults([{ status: 'Passed' }] as any);
    expect(verdictOf(allPassed, 2, true)).toBe('error');
    expect(verdictOf(allPassed, 1, false)).toBe('completed');
  });
});

describe('a shared run that loses a helper', () => {
  /** A helper that claims an item, starts its first test, and dies. */
  function dyingHelper() {
    registerShardDispatcher(async ({ executionId }) => {
      const claim = (await claimWorkItem(executionId, 'ghost'))!;
      await beginAttempt({ executionId, unitId: claim.unit.units[0].unitId! }, claimFence(claim));
      await expire(executionId, claim.workItemKey);
    });
  }

  async function runPlan() {
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({
      id: executionId,
      organizationId,
      testPlanId: planId,
      status: 'queued',
      triggeredBy: 'manual',
    } as any);
    await processTestPlanJob(planId, executionId, userId);
    const [run] = await privilegedDb
      .select()
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, executionId));
    return run;
  }

  it('ends incomplete with the lost result said, replays nothing, and notifies once', async () => {
    await privilegedDb
      .update(testPlans)
      .set({ shards: 2 } as any)
      .where(eq(testPlans.id, planId));
    dyingHelper();
    const run = await runPlan();

    expect(run).toMatchObject({ status: 'error', failureCode: 'run_incomplete' });
    expect(run.failureMessage).toMatch(/1 of 2 expected unit\(s\) have no result: 1 indeterminate/);
    // The lost unit was not run again: only the other test reached the application.
    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(await resultsOf(run.id)).toHaveLength(1);
    expect(notifyRunFinished).toHaveBeenCalledTimes(1);
    expect(notifyRunFinished.mock.calls[0][0].summary.status).toBe('error');

    // The ghost wakes up and writes its result: refused, and the verdict stands.
    const [lost] = (await unitsOf(run.id)).filter((u) => u.state === 'indeterminate');
    await expect(
      inTenant(() =>
        saveReportEntry(
          logger,
          snapshot,
          { ...entryFor(run.id, 0, 1), executionUnitId: lost.unitId },
          {
            fence: runFence(run.id),
          },
        ),
      ),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    expect(await resultsOf(run.id)).toHaveLength(1);
    expect(notifyRunFinished).toHaveBeenCalledTimes(1);
  });

  it('runs the lost unit again only when the plan says it may', async () => {
    await privilegedDb
      .update(testPlans)
      .set({ shards: 2, workerLossPolicy: 'replay' } as any)
      .where(eq(testPlans.id, planId));
    dyingHelper();
    const run = await runPlan();

    expect(run).toMatchObject({ status: 'completed', totalTests: 2, passedTests: 2 });
    const attempts = await attemptsOf(run.id);
    // The ghost's try stays on record as abandoned; the replay is a try of its own.
    expect(attempts.filter((a) => a.state === 'abandoned')).toHaveLength(1);
    expect(attempts.filter((a) => a.state === 'finished')).toHaveLength(2);
    expect(notifyRunFinished).toHaveBeenCalledTimes(1);
  });
});
