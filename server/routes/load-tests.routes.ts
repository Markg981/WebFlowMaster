import { type Response } from 'express';
import { asyncRouter } from '../middleware/async-router';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  apiTests,
  environments,
  loadTestRuns,
  loadTests,
  testDataSets,
} from '@shared/schema';
import {
  LOAD_LIMITS,
  LOAD_LIVE_RUN_STATUSES,
  dataSetProblem,
  loadTestSchemaFor,
  profileProblem,
  type LoadTestDefinition,
} from '@shared/load-test';
import { requireRole } from '../middleware/require-role';
import { getTenantOrgId, withTenantTransaction, type TenantTx } from '../middleware/tenancy';
import { auditActor, recordAudit } from '../tenancy/audit';
import { checkExecutionBudget } from '../tenancy/execution-usage';
import { assertSubscriptionAllowsRuns } from '../tenancy/billing/enforcement';
import { lockOrganizationRuns, quotaErrorBody, quotaErrorStatus } from '../tenancy/tenant-quotas';
import {
  enqueueLoadRun,
  loadLimits,
  recoverLostLoadRuns,
  removeQueuedLoadJob,
  snapshotOf,
} from '../api-tests/load-runner';
import logger from '../logger';

/**
 * Load tests (shared/load-test.ts): writing them, and running them on their own — a run is queued
 * here for a load worker (server/api-tests/load-runner.ts) and followed from the page, which reads its
 * summary as the worker writes it.
 */

const router = asyncRouter();

/** What queues a run and what takes a queued one back. Fields so the tests can stand them in. */
export const loadRunner: {
  enqueue: (runId: string, organizationId: number, userId: number) => Promise<string>;
  dequeue: (jobId: string | null) => Promise<boolean>;
} = {
  enqueue: enqueueLoadRun,
  dequeue: removeQueuedLoadJob,
};

class LoadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(res: Response, error: unknown, what: string) {
  const quota = quotaErrorBody(error);
  if (quota) return res.status(quotaErrorStatus(error)).json(quota);
  if (error instanceof LoadError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error)?.message ?? '';
  if (/unique|duplicate/i.test(message))
    return res.status(409).json({ error: 'A load test with this name already exists.' });
  if (/foreign key|row-level security/i.test(message))
    return res.status(400).json({ error: 'Invalid project ID or project does not exist.' });
  logger.error({ message: `Failed to ${what}`, error: message });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

const idOf = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new LoadError(400, 'Invalid load test id.');
  return id;
};

async function editableProject(tx: TenantTx, projectId: number | null) {
  const result = await tx.execute(sql`SELECT app_project_editable(${projectId}::int) AS ok`);
  if (!(result.rows?.[0] as { ok?: boolean } | undefined)?.ok) {
    throw new LoadError(403, "You can view this load test's project but not change it.");
  }
}

async function editableTest(tx: TenantTx, id: number) {
  const [test] = await tx.select().from(loadTests).where(eq(loadTests.id, id)).limit(1);
  if (!test) throw new LoadError(404, 'Load test not found.');
  await editableProject(tx, test.projectId);
  return test;
}

/** The API tests and the data set a definition names exist, and can be read by whoever saves it. */
async function checkReferences(
  tx: TenantTx,
  definition: Pick<LoadTestDefinition, 'steps' | 'dataSetId' | 'dataMode' | 'stages'>,
) {
  const ids = [...new Set(definition.steps.map((step) => step.apiTestId))];
  const found = await tx
    .select({ id: apiTests.id })
    .from(apiTests)
    .where(inArray(apiTests.id, ids));
  const known = new Set(found.map((row) => row.id));
  const missing = ids.find((id) => !known.has(id));
  if (missing !== undefined) throw new LoadError(400, `API test #${missing} not found.`);
  if (definition.dataSetId) {
    const [set] = await tx
      .select({ rows: sql<number>`jsonb_array_length(${testDataSets.rows})`.mapWith(Number) })
      .from(testDataSets)
      .where(
        and(
          eq(testDataSets.id, definition.dataSetId),
          eq(testDataSets.organizationId, getTenantOrgId()!),
        ),
      )
      .limit(1);
    if (!set) throw new LoadError(400, 'Data set not found.');
    const problem = dataSetProblem(definition, set.rows);
    if (problem) throw new LoadError(400, problem);
  }
}

/** Runs whose worker stopped answering are over: they say so (server/api-tests/load-runner.ts). */
async function settleInterrupted(tx: TenantTx) {
  const lost = await recoverLostLoadRuns(tx);
  if (lost.length) logger.warn({ message: 'Ended load runs nobody was running any more', lost });
}

/** A run as the page reads it: not the definition it keeps for itself. */
const shownRun = ({
  organizationId: _org,
  projectId: _project,
  definition: _definition,
  requestedBy: _by,
  heartbeatAt: _beat,
  jobId: _job,
  workerId: _worker,
  ...shown
}: typeof loadTestRuns.$inferSelect) => shown;

const runColumns = {
  id: loadTestRuns.id,
  loadTestId: loadTestRuns.loadTestId,
  environmentId: loadTestRuns.environmentId,
  status: loadTestRuns.status,
  summary: loadTestRuns.summary,
  error: loadTestRuns.error,
  cancelRequested: loadTestRuns.cancelRequested,
  queuedAt: loadTestRuns.queuedAt,
  startedAt: loadTestRuns.startedAt,
  finishedAt: loadTestRuns.finishedAt,
};

/** The limits of this installation, for whoever writes a load test against them. */
router.get('/api/load-tests/limits', requireRole('viewer'), (_req, res) => {
  try {
    const limits = loadLimits();
    res.json({
      virtualUsers: limits.virtualUsers,
      durationSec: limits.durationSec,
      stages: LOAD_LIMITS.stages,
      steps: LOAD_LIMITS.steps,
      thinkTimeMs: LOAD_LIMITS.thinkTimeMs,
      runsPerOrganization: limits.runsPerOrganization,
    });
  } catch (error) {
    fail(res, error, 'read the load limits');
  }
});

router.get('/api/load-tests', requireRole('viewer'), async (_req, res) => {
  try {
    const rows = await withTenantTransaction(async (tx) => {
      await settleInterrupted(tx);
      const all = await tx.select().from(loadTests).orderBy(loadTests.name);
      const latest = await tx
        .selectDistinctOn([loadTestRuns.loadTestId], {
          loadTestId: loadTestRuns.loadTestId,
          id: loadTestRuns.id,
          status: loadTestRuns.status,
          startedAt: loadTestRuns.startedAt,
        })
        .from(loadTestRuns)
        .orderBy(loadTestRuns.loadTestId, desc(loadTestRuns.startedAt));
      const byTest = new Map(latest.map((run) => [run.loadTestId, run]));
      return all.map((test) => ({ ...test, lastRun: byTest.get(test.id) ?? null }));
    });
    res.json(rows);
  } catch (error) {
    fail(res, error, 'load the load tests');
  }
});

router.get('/api/load-tests/:id', requireRole('viewer'), async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const found = await withTenantTransaction(async (tx) => {
      await settleInterrupted(tx);
      const [test] = await tx.select().from(loadTests).where(eq(loadTests.id, id)).limit(1);
      if (!test) return null;
      const runs = await tx
        .select(runColumns)
        .from(loadTestRuns)
        .where(eq(loadTestRuns.loadTestId, id))
        .orderBy(desc(loadTestRuns.startedAt))
        .limit(10);
      return { ...test, runs };
    });
    if (!found) return res.status(404).json({ error: 'Load test not found.' });
    res.json(found);
  } catch (error) {
    fail(res, error, 'load the load test');
  }
});

const valuesOf = (data: LoadTestDefinition) => ({
  name: data.name,
  description: data.description ?? null,
  projectId: data.projectId ?? null,
  steps: data.steps,
  stages: data.stages,
  warmUpSec: data.warmUpSec,
  dataSetId: data.dataSetId ?? null,
  dataMode: data.dataMode,
  thresholds: data.thresholds,
});

router.post('/api/load-tests', requireRole('editor'), async (req, res) => {
  const parsed = loadTestSchemaFor(loadLimits()).safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid load test' });
  try {
    const created = await withTenantTransaction(async (tx) => {
      await editableProject(tx, parsed.data.projectId ?? null);
      await checkReferences(tx, parsed.data);
      const [row] = await tx
        .insert(loadTests)
        .values({
          ...valuesOf(parsed.data),
          organizationId: getTenantOrgId()!,
          createdBy: req.user!.id,
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.LOAD_TEST_CREATED,
        actor: auditActor(req),
        targetType: 'load_test',
        targetId: row.id,
        metadata: { name: row.name, steps: row.steps.length, stages: row.stages.length },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, 'create the load test');
  }
});

router.put('/api/load-tests/:id', requireRole('editor'), async (req, res) => {
  const parsed = loadTestSchemaFor(loadLimits()).safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid load test' });
  try {
    const id = idOf(req.params.id);
    const updated = await withTenantTransaction(async (tx) => {
      await editableTest(tx, id);
      await editableProject(tx, parsed.data.projectId ?? null);
      await checkReferences(tx, parsed.data);
      const [row] = await tx
        .update(loadTests)
        .set({ ...valuesOf(parsed.data), updatedAt: new Date() })
        .where(eq(loadTests.id, id))
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.LOAD_TEST_UPDATED,
        actor: auditActor(req),
        targetType: 'load_test',
        targetId: id,
        metadata: { name: row.name, steps: row.steps.length, stages: row.stages.length },
      });
      return row;
    });
    res.json(updated);
  } catch (error) {
    fail(res, error, 'update the load test');
  }
});

router.delete('/api/load-tests/:id', requireRole('editor'), async (req, res) => {
  try {
    const id = idOf(req.params.id);
    await withTenantTransaction(async (tx) => {
      const test = await editableTest(tx, id);
      const [live] = await tx
        .select({ id: loadTestRuns.id })
        .from(loadTestRuns)
        .where(
          and(
            eq(loadTestRuns.loadTestId, id),
            inArray(loadTestRuns.status, [...LOAD_LIVE_RUN_STATUSES]),
          ),
        )
        .limit(1);
      if (live) throw new LoadError(409, 'The load test is running: cancel the run first.');
      await tx.delete(loadTests).where(eq(loadTests.id, id));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.LOAD_TEST_DELETED,
        actor: auditActor(req),
        targetType: 'load_test',
        targetId: id,
        metadata: { name: test.name },
      });
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'delete the load test');
  }
});

const runSchema = z
  .object({ environmentId: z.number().int().positive().optional().nullable() })
  .strict();

/**
 * POST /api/load-tests/:id/runs — { environmentId? }: queues a run for a load worker and answers
 * it at once (202, status `queued`); the page follows it. LOAD_MAX_RUNS_PER_ORGANIZATION (one by
 * default) runs of an organization may be queued or running at once: two would measure each
 * other. The worker checks the limit again when it takes the run.
 */
router.post('/api/load-tests/:id/runs', requireRole('editor'), async (req, res) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid run' });
  try {
    const id = idOf(req.params.id);
    const organizationId = getTenantOrgId()!;
    const limits = loadLimits();
    const run = await withTenantTransaction(async (tx) => {
      await lockOrganizationRuns(tx, organizationId);
      // The load enqueue point: a suspended subscription is refused before the run row exists
      // (server/tenancy/billing/enforcement.ts), so nothing is left behind as "queued" or "error".
      await assertSubscriptionAllowsRuns(tx, organizationId);
      await checkExecutionBudget(tx, organizationId);
      const test = await editableTest(tx, id);
      // A test saved under a higher limit than today's is refused here, naming the limit.
      const beyond = profileProblem(test.stages, limits);
      if (beyond) throw new LoadError(400, beyond);
      await checkReferences(tx, test);
      if (parsed.data.environmentId) {
        const [environment] = await tx
          .select({ id: environments.id })
          .from(environments)
          .where(eq(environments.id, parsed.data.environmentId))
          .limit(1);
        if (!environment) throw new LoadError(404, 'Environment not found.');
      }
      await settleInterrupted(tx);
      const [{ live }] = await tx
        .select({ live: count() })
        .from(loadTestRuns)
        .where(inArray(loadTestRuns.status, [...LOAD_LIVE_RUN_STATUSES]));
      if (live >= limits.runsPerOrganization) {
        throw new LoadError(
          409,
          limits.runsPerOrganization === 1
            ? 'Another load test of the organization is queued or running. Wait for it to end, or cancel it (LOAD_MAX_RUNS_PER_ORGANIZATION).'
            : `The organization already has ${live} load runs queued or running; the limit is ${limits.runsPerOrganization} (LOAD_MAX_RUNS_PER_ORGANIZATION).`,
        );
      }
      const now = new Date();
      const [row] = await tx
        .insert(loadTestRuns)
        .values({
          id: randomUUID(),
          organizationId,
          loadTestId: test.id,
          projectId: test.projectId,
          environmentId: parsed.data.environmentId ?? null,
          status: 'queued',
          definition: snapshotOf(test) as unknown as Record<string, unknown>,
          requestedBy: req.user!.id,
          queuedAt: now,
          startedAt: now,
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.LOAD_TEST_RUN,
        actor: auditActor(req),
        targetType: 'load_test',
        targetId: test.id,
        metadata: { name: test.name, runId: row.id },
      });
      return shownRun(row);
    });
    // Queued once the row is committed, so a worker that takes the job at once finds it.
    try {
      await loadRunner.enqueue(run.id, organizationId, req.user!.id);
    } catch (error) {
      logger.error({
        message: 'Load run could not be queued',
        runId: run.id,
        error: String(error),
      });
      await withTenantTransaction(async (tx) => {
        await tx
          .update(loadTestRuns)
          .set({ status: 'error', error: 'The queue refused the run.', finishedAt: new Date() })
          .where(eq(loadTestRuns.id, run.id));
      }).catch(() => undefined);
      return res.status(503).json({ error: 'The queue refused the run. Try again in a moment.' });
    }
    res.status(202).json(run);
  } catch (error) {
    fail(res, error, 'start the load test');
  }
});

router.get('/api/load-test-runs/:runId', requireRole('viewer'), async (req, res) => {
  try {
    const run = await withTenantTransaction(async (tx) => {
      await settleInterrupted(tx);
      const [row] = await tx
        .select(runColumns)
        .from(loadTestRuns)
        .where(eq(loadTestRuns.id, req.params.runId))
        .limit(1);
      return row;
    });
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    res.json(run);
  } catch (error) {
    fail(res, error, 'load the run');
  }
});

/**
 * POST /api/load-test-runs/:runId/cancel — a queued run is taken off the queue and ends now; a
 * running one is flagged, and the worker stops at its next progress (2 s at most).
 */
router.post('/api/load-test-runs/:runId/cancel', requireRole('editor'), async (req, res) => {
  try {
    const run = await withTenantTransaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(loadTestRuns)
        .where(eq(loadTestRuns.id, req.params.runId))
        .limit(1);
      if (!current) throw new LoadError(404, 'Run not found.');
      await editableTest(tx, current.loadTestId);
      if (current.status !== 'queued' && current.status !== 'running')
        throw new LoadError(409, 'The run is already over.');
      // The flag first, whatever the status: a worker taking the job this instant reads it.
      await tx
        .update(loadTestRuns)
        .set({ cancelRequested: true })
        .where(eq(loadTestRuns.id, current.id));
      let [row] = await tx
        .select()
        .from(loadTestRuns)
        .where(eq(loadTestRuns.id, current.id))
        .limit(1);
      if (current.status === 'queued') {
        const dequeued = await loadRunner.dequeue(current.jobId);
        // Still queued when nobody took it meanwhile: over now. Taken: the worker ends it.
        const [ended] = await tx
          .update(loadTestRuns)
          .set({ status: 'cancelled', finishedAt: new Date() })
          .where(and(eq(loadTestRuns.id, current.id), eq(loadTestRuns.status, 'queued')))
          .returning();
        if (ended) row = ended;
        else if (!dequeued)
          logger.info({ message: 'Load run taken while being cancelled', runId: current.id });
      }
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.LOAD_TEST_CANCELLED,
        actor: auditActor(req),
        targetType: 'load_test',
        targetId: current.loadTestId,
        metadata: { runId: current.id },
      });
      return shownRun(row);
    });
    res.status(202).json(run);
  } catch (error) {
    fail(res, error, 'cancel the run');
  }
});

export default router;
