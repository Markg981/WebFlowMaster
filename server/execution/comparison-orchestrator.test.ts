import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import {
  comparisonRuns,
  environments,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
} from '@shared/schema';
import { emptyVerdictCounts, type ComparisonSummary } from '@shared/comparison';
import { createTestOrganization } from '../tests/factories';
import { runWithTenant } from '../platform/middleware/tenancy';
import { readExecutionSnapshot } from './execution-snapshot';
import { createExecutionOrchestrator } from './execution-orchestrator';
import { createComparisonOrchestrator, type ComparisonEngine } from './comparison-orchestrator';
import { registerComparisonFinalizer, sweepComparisons } from './comparison-finalizer';
import { transitionExecution } from './execution-state';

/**
 * A comparison's life without the engine: it starts its baseline, starts the candidate when it
 * should, waits for a full queue, stops when asked, and is computed exactly once.
 */

const summary: ComparisonSummary = {
  total: 0,
  byVerdict: emptyVerdictCounts(),
  byModule: [],
  droppedDifferences: 0,
};

/** A queue that accepts every job and runs none: the runs stay where the test puts them. */
const queue = {
  add: async (_name: string, _data: unknown, options: { jobId: string }) => ({ id: options.jobId }),
};

let organizationId: number;
let otherOrganizationId: number;
let userId: number;
let outsiderId: number;
let planId: string;
let prodId: number;
let stagingId: number;
let theirsId: number;
let engine: ReturnType<typeof vi.fn<ComparisonEngine>>;

const executions = () => createExecutionOrchestrator(queue as any);
const orchestratorWith = (overrides: Partial<ReturnType<typeof executions>> = {}) =>
  createComparisonOrchestrator({ executions: { ...executions(), ...overrides }, engine });

const asUs = <T>(fn: () => Promise<T>) => runWithTenant(organizationId, fn);

async function comparisonRow(id: string) {
  const [row] = await privilegedDb.select().from(comparisonRuns).where(eq(comparisonRuns.id, id));
  return row;
}

async function executionRow(id: string) {
  const [row] = await privilegedDb
    .select()
    .from(testPlanExecutions)
    .where(eq(testPlanExecutions.id, id));
  return row;
}

/** Ends a run as a worker would have. */
async function endRun(id: string, status: 'completed' | 'failed' | 'error' | 'cancelled') {
  await privilegedDb
    .update(testPlanExecutions)
    .set({ status, completedAt: new Date() })
    .where(eq(testPlanExecutions.id, id));
}

function create(
  orchestrator: ReturnType<typeof orchestratorWith>,
  input: Partial<{ mode: 'sequential' | 'parallel'; candidateEnvironmentId: number }> = {},
  idempotencyKey?: string,
) {
  return asUs(() =>
    orchestrator.create({
      planId,
      requestedByUserId: userId,
      idempotencyKey,
      input: {
        baselineEnvironmentId: prodId,
        candidateEnvironmentId: input.candidateEnvironmentId ?? stagingId,
        mode: input.mode ?? 'sequential',
      },
    }),
  );
}

beforeEach(async () => {
  await privilegedDb.delete(comparisonRuns);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(environments);
  await privilegedDb.delete(users);

  organizationId = await createTestOrganization('Comparison Org');
  otherOrganizationId = await createTestOrganization('Somebody Else');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `cmp-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;
  const [outsider] = await privilegedDb
    .insert(users)
    .values({
      username: `outsider-${uuidv4().slice(0, 8)}`,
      password: 'hashed',
      organizationId: otherOrganizationId,
    })
    .returning();
  outsiderId = outsider.id;

  planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Checkout', userId, organizationId } as any);
  const [test] = await privilegedDb
    .insert(testsTable)
    .values({
      userId,
      organizationId,
      name: 'first',
      url: 'https://example.test/first',
      sequence: [],
      elements: [],
    })
    .returning();
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);

  const [prod, staging] = await privilegedDb
    .insert(environments)
    .values([
      { name: 'prod', userId, organizationId },
      { name: 'staging', userId, organizationId },
    ])
    .returning();
  prodId = prod.id;
  stagingId = staging.id;
  const [theirs] = await privilegedDb
    .insert(environments)
    .values({ name: 'theirs', userId: outsiderId, organizationId: otherOrganizationId })
    .returning();
  theirsId = theirs.id;

  engine = vi.fn<ComparisonEngine>(async () => ({ verdict: 'parity', summary }));
});

describe('creating a comparison', () => {
  it('starts the baseline only, and the same key returns the same comparison', async () => {
    const orchestrator = orchestratorWith();
    const { comparison, created } = await create(orchestrator, {}, 'key-1');

    expect(created).toBe(true);
    expect(comparison).toMatchObject({
      status: 'running',
      baselineEnvironmentName: 'prod',
      candidateEnvironmentName: 'staging',
      candidateExecutionId: null,
    });
    const baseline = await executionRow(comparison.baselineExecutionId!);
    expect(baseline.environment).toBe(String(prodId));
    expect(readExecutionSnapshot(baseline.configurationSnapshot)?.comparison).toEqual({
      id: comparison.id,
      role: 'baseline',
    });
    // The stored policy is the whole default, not what the request left out.
    expect((comparison.policy as any).visual.mode).toBe('informative');

    const again = await create(orchestrator, {}, 'key-1');
    expect(again).toMatchObject({ created: false, comparison: { id: comparison.id } });
    expect(await privilegedDb.select().from(testPlanExecutions)).toHaveLength(1);
  });

  it('starts both runs at once in parallel mode', async () => {
    const { comparison } = await create(orchestratorWith(), { mode: 'parallel' });

    expect(comparison.status).toBe('running');
    const candidate = await executionRow(comparison.candidateExecutionId!);
    expect(candidate.environment).toBe(String(stagingId));
    expect(readExecutionSnapshot(candidate.configurationSnapshot)?.comparison).toEqual({
      id: comparison.id,
      role: 'candidate',
    });
  });

  it('leaves nothing behind when the baseline is refused', async () => {
    const refused = Object.assign(new Error('The organization queue is full.'), { status: 429 });
    const orchestrator = orchestratorWith({ enqueue: async () => Promise.reject(refused) });

    await expect(create(orchestrator)).rejects.toMatchObject({ status: 429 });
    expect(await privilegedDb.select().from(comparisonRuns)).toEqual([]);
  });

  it("does not compare another organization's plan or environment", async () => {
    const orchestrator = orchestratorWith();
    await expect(create(orchestrator, { candidateEnvironmentId: theirsId })).rejects.toMatchObject({
      code: 'environment_not_found',
      status: 404,
    });
    await expect(
      runWithTenant(otherOrganizationId, () =>
        orchestrator.create({
          planId,
          requestedByUserId: outsiderId,
          input: {
            baselineEnvironmentId: theirsId,
            candidateEnvironmentId: theirsId + 1,
            mode: 'sequential',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'plan_not_found', status: 404 });
    expect(await privilegedDb.select().from(comparisonRuns)).toEqual([]);

    const { comparison } = await create(orchestrator);
    expect(
      await runWithTenant(otherOrganizationId, () => orchestrator.advance(comparison.id)),
    ).toBeNull();
  });
});

describe('advancing a comparison', () => {
  it('starts the candidate after the baseline, then compares once', async () => {
    const orchestrator = orchestratorWith();
    const { comparison } = await create(orchestrator);

    // The baseline still running: nothing to do.
    expect(await asUs(() => orchestrator.advance(comparison.id))).toMatchObject({
      status: 'running',
      candidateExecutionId: null,
    });

    await endRun(comparison.baselineExecutionId!, 'failed');
    const started = await asUs(() => orchestrator.advance(comparison.id));
    expect(started?.candidateExecutionId).toBeTruthy();
    const candidate = await executionRow(started!.candidateExecutionId!);
    expect(candidate.environment).toBe(String(stagingId));

    // The candidate still running: not compared yet.
    await asUs(() => orchestrator.advance(comparison.id));
    expect(engine).not.toHaveBeenCalled();

    await endRun(candidate.id, 'completed');
    const done = await asUs(() => orchestrator.advance(comparison.id));
    expect(done).toMatchObject({ status: 'completed', verdict: 'parity', summary });
    expect(done?.completedAt).toBeInstanceOf(Date);
    await asUs(() => orchestrator.advance(comparison.id));
    expect(engine).toHaveBeenCalledTimes(1);
  });

  it('is computed by only one of two callers that see the second run end', async () => {
    const orchestrator = orchestratorWith();
    const { comparison } = await create(orchestrator, { mode: 'parallel' });
    await endRun(comparison.baselineExecutionId!, 'completed');
    await endRun(comparison.candidateExecutionId!, 'completed');

    await Promise.all([
      asUs(() => orchestrator.advance(comparison.id)),
      asUs(() => orchestrator.advance(comparison.id)),
    ]);

    expect(engine).toHaveBeenCalledTimes(1);
    expect((await comparisonRow(comparison.id)).status).toBe('completed');
  });

  it('ends in error when the engine fails, and keeps no verdict', async () => {
    engine.mockRejectedValueOnce(new Error('screenshots unreadable'));
    const orchestrator = orchestratorWith();
    const { comparison } = await create(orchestrator, { mode: 'parallel' });
    await endRun(comparison.baselineExecutionId!, 'completed');
    await endRun(comparison.candidateExecutionId!, 'completed');

    const ended = await asUs(() => orchestrator.advance(comparison.id));
    expect(ended).toMatchObject({
      status: 'error',
      failureCode: 'compare_failed',
      failureMessage: 'screenshots unreadable',
      verdict: null,
    });
  });

  it('follows a baseline that was cancelled or ended in error', async () => {
    const orchestrator = orchestratorWith();
    const first = await create(orchestrator);
    await endRun(first.comparison.baselineExecutionId!, 'cancelled');
    expect((await asUs(() => orchestrator.advance(first.comparison.id)))?.status).toBe('cancelled');

    const second = await create(orchestrator);
    await endRun(second.comparison.baselineExecutionId!, 'error');
    expect(await asUs(() => orchestrator.advance(second.comparison.id))).toMatchObject({
      status: 'error',
      failureCode: 'baseline_error',
    });
  });

  it('waits for a full queue, and the sweep starts the candidate later', async () => {
    const full = Object.assign(new Error('The organization queue is full.'), { status: 429 });
    const real = executions();
    const replay = vi.fn(real.replay).mockRejectedValueOnce(full);
    const orchestrator = orchestratorWith({ replay });
    const { comparison } = await create(orchestrator);
    await endRun(comparison.baselineExecutionId!, 'completed');

    expect(await asUs(() => orchestrator.advance(comparison.id))).toMatchObject({
      status: 'running',
      candidateExecutionId: null,
      failureCode: 'candidate_deferred',
      failureMessage: 'The organization queue is full.',
    });

    expect(await sweepComparisons(orchestrator)).toBe(1);
    expect(await comparisonRow(comparison.id)).toMatchObject({
      status: 'running',
      candidateExecutionId: expect.any(String),
      failureCode: null,
      failureMessage: null,
    });
  });

  it('ends in error when the candidate is refused for good', async () => {
    const gone = Object.assign(new Error('Environment not found'), { status: 404 });
    const orchestrator = orchestratorWith({ replay: async () => Promise.reject(gone) });
    const { comparison } = await create(orchestrator);
    await endRun(comparison.baselineExecutionId!, 'completed');

    expect(await asUs(() => orchestrator.advance(comparison.id))).toMatchObject({
      status: 'error',
      failureCode: 'candidate_refused',
    });
  });
});

describe('cancelling a comparison', () => {
  it('stops the comparison and both its runs', async () => {
    const orchestrator = orchestratorWith();
    const { comparison } = await create(orchestrator, { mode: 'parallel' });

    const outcome = await asUs(() => orchestrator.cancel(comparison.id, 'Not needed'));
    expect(outcome).toMatchObject({ outcome: 'cancelled', comparison: { status: 'cancelled' } });
    for (const id of [comparison.baselineExecutionId!, comparison.candidateExecutionId!]) {
      expect((await executionRow(id)).status).toBe('cancelled');
    }

    expect(await asUs(() => orchestrator.cancel(comparison.id, 'Again'))).toEqual({
      outcome: 'already_ended',
      status: 'cancelled',
    });
    expect(await asUs(() => orchestrator.cancel(uuidv4(), 'Nothing'))).toEqual({
      outcome: 'not_found',
    });
  });

  it('is not cancelled from another organization', async () => {
    const orchestrator = orchestratorWith();
    const { comparison } = await create(orchestrator);
    expect(
      await runWithTenant(otherOrganizationId, () => orchestrator.cancel(comparison.id, 'No')),
    ).toEqual({ outcome: 'not_found' });
    expect((await comparisonRow(comparison.id)).status).toBe('running');
  });
});

describe('the finalizer', () => {
  it('advances the comparison when one of its runs ends', async () => {
    const orchestrator = orchestratorWith();
    const { comparison } = await create(orchestrator);
    const advance = vi.fn(async () => null);
    const off = registerComparisonFinalizer({ advance });
    try {
      await runWithTenant(organizationId, () =>
        transitionExecution(comparison.baselineExecutionId!, 'running'),
      );
      expect(advance).not.toHaveBeenCalled();
      await runWithTenant(organizationId, () =>
        transitionExecution(comparison.baselineExecutionId!, 'completed'),
      );
      await vi.waitFor(() => expect(advance).toHaveBeenCalledWith(comparison.id));
    } finally {
      off();
    }
  });
});
