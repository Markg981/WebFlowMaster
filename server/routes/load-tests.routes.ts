import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { AUDIT_ACTIONS, apiTests, environments, loadTestRuns, loadTests, testDataSets } from '@shared/schema';
import { dataSetProblem, loadTestSchema, type LoadTestDefinition } from '@shared/load-test';
import { requireRole } from '../middleware/require-role';
import { getTenantOrgId, withTenantTransaction, type TenantTx } from '../middleware/tenancy';
import { auditActor, recordAudit } from '../audit';
import { checkExecutionBudget } from '../execution-usage';
import { lockOrganizationRuns, quotaErrorBody } from '../tenant-quotas';
import {
  LOAD_HEARTBEAT_STALE_MS,
  executeLoadRun,
  releaseLoadSlot,
  reserveLoadSlot,
  snapshotOf,
} from '../load-runner';
import loggerPromise from '../logger';

/**
 * Load tests (shared/load-test.ts): writing them, and running them on their own — a run is started
 * here and followed from the page, which reads its summary as the runner writes it.
 */

const router = Router();
const logger = await loggerPromise;

/** What starts a run. A field so the tests can wait for the run they started. */
export const loadRunner: { start: (runId: string, organizationId: number, userId: number) => Promise<void> } = {
  start: executeLoadRun,
};

class LoadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(res: Response, error: unknown, what: string) {
  const quota = quotaErrorBody(error);
  if (quota) return res.status(429).json(quota);
  if (error instanceof LoadError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error)?.message ?? '';
  if (/unique|duplicate/i.test(message)) return res.status(409).json({ error: 'A load test with this name already exists.' });
  if (/foreign key|row-level security/i.test(message)) return res.status(400).json({ error: 'Invalid project ID or project does not exist.' });
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
async function checkReferences(tx: TenantTx, definition: Pick<LoadTestDefinition, 'steps' | 'dataSetId' | 'dataMode' | 'stages'>) {
  const ids = [...new Set(definition.steps.map((step) => step.apiTestId))];
  const found = await tx.select({ id: apiTests.id }).from(apiTests).where(inArray(apiTests.id, ids));
  const known = new Set(found.map((row) => row.id));
  const missing = ids.find((id) => !known.has(id));
  if (missing !== undefined) throw new LoadError(400, `API test #${missing} not found.`);
  if (definition.dataSetId) {
    const [set] = await tx
      .select({ rows: sql<number>`jsonb_array_length(${testDataSets.rows})`.mapWith(Number) })
      .from(testDataSets)
      .where(and(eq(testDataSets.id, definition.dataSetId), eq(testDataSets.organizationId, getTenantOrgId()!)))
      .limit(1);
    if (!set) throw new LoadError(400, 'Data set not found.');
    const problem = dataSetProblem(definition, set.rows);
    if (problem) throw new LoadError(400, problem);
  }
}

/** Runs left "running" by a process that stopped (restart, crash) are over: they say so. */
async function settleInterrupted(tx: TenantTx) {
  const staleBefore = new Date(Date.now() - LOAD_HEARTBEAT_STALE_MS);
  await tx
    .update(loadTestRuns)
    .set({ status: 'error', error: 'Interrupted: the server running it stopped.', finishedAt: new Date() })
    .where(and(eq(loadTestRuns.status, 'running'), lt(sql`coalesce(${loadTestRuns.heartbeatAt}, ${loadTestRuns.startedAt})`, staleBefore)));
}

/** A run as the page reads it: not the definition it keeps for itself. */
const shownRun = ({ organizationId: _org, projectId: _project, definition: _definition, requestedBy: _by, heartbeatAt: _beat, ...shown }: typeof loadTestRuns.$inferSelect) => shown;

const runColumns = {
  id: loadTestRuns.id,
  loadTestId: loadTestRuns.loadTestId,
  environmentId: loadTestRuns.environmentId,
  status: loadTestRuns.status,
  summary: loadTestRuns.summary,
  error: loadTestRuns.error,
  cancelRequested: loadTestRuns.cancelRequested,
  startedAt: loadTestRuns.startedAt,
  finishedAt: loadTestRuns.finishedAt,
};

router.get('/api/load-tests', requireRole('viewer'), async (_req, res) => {
  try {
    const rows = await withTenantTransaction(async (tx) => {
      await settleInterrupted(tx);
      const all = await tx.select().from(loadTests).orderBy(loadTests.name);
      const latest = await tx
        .selectDistinctOn([loadTestRuns.loadTestId], { loadTestId: loadTestRuns.loadTestId, id: loadTestRuns.id, status: loadTestRuns.status, startedAt: loadTestRuns.startedAt })
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
      const runs = await tx.select(runColumns).from(loadTestRuns).where(eq(loadTestRuns.loadTestId, id)).orderBy(desc(loadTestRuns.startedAt)).limit(10);
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
  const parsed = loadTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid load test' });
  try {
    const created = await withTenantTransaction(async (tx) => {
      await editableProject(tx, parsed.data.projectId ?? null);
      await checkReferences(tx, parsed.data);
      const [row] = await tx
        .insert(loadTests)
        .values({ ...valuesOf(parsed.data), organizationId: getTenantOrgId()!, createdBy: req.user!.id })
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
  const parsed = loadTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid load test' });
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
      const [running] = await tx
        .select({ id: loadTestRuns.id })
        .from(loadTestRuns)
        .where(and(eq(loadTestRuns.loadTestId, id), eq(loadTestRuns.status, 'running')))
        .limit(1);
      if (running) throw new LoadError(409, 'The load test is running: cancel the run first.');
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

const runSchema = z.object({ environmentId: z.number().int().positive().optional().nullable() }).strict();

/**
 * POST /api/load-tests/:id/runs — { environmentId? }: starts a run in this server process and
 * answers it at once (202); the page follows it. One load run at a time per organization.
 */
router.post('/api/load-tests/:id/runs', requireRole('editor'), async (req, res) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid run' });
  if (!reserveLoadSlot()) {
    return res.status(503).json({ error: 'This server is already running as many load tests as it may. Try again when one ends.' });
  }
  let started = false;
  try {
    const id = idOf(req.params.id);
    const organizationId = getTenantOrgId()!;
    const run = await withTenantTransaction(async (tx) => {
      await lockOrganizationRuns(tx, organizationId);
      await checkExecutionBudget(tx, organizationId);
      const test = await editableTest(tx, id);
      await checkReferences(tx, test);
      if (parsed.data.environmentId) {
        const [environment] = await tx.select({ id: environments.id }).from(environments).where(eq(environments.id, parsed.data.environmentId)).limit(1);
        if (!environment) throw new LoadError(404, 'Environment not found.');
      }
      await settleInterrupted(tx);
      // Two load tests at once would measure each other.
      const [busy] = await tx.select({ id: loadTestRuns.id }).from(loadTestRuns).where(eq(loadTestRuns.status, 'running')).limit(1);
      if (busy) throw new LoadError(409, 'Another load test of the organization is running. Wait for it to end, or cancel it.');
      const [row] = await tx
        .insert(loadTestRuns)
        .values({
          id: randomUUID(),
          organizationId,
          loadTestId: test.id,
          projectId: test.projectId,
          environmentId: parsed.data.environmentId ?? null,
          status: 'running',
          definition: snapshotOf(test) as unknown as Record<string, unknown>,
          requestedBy: req.user!.id,
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
    started = true;
    // Not awaited: the page follows the run, and the runner writes whatever happens on it.
    void loadRunner.start(run.id, organizationId, req.user!.id).catch((error) =>
      logger.error({ message: 'Load run crashed', runId: run.id, error: String(error) }),
    );
    res.status(202).json(run);
  } catch (error) {
    fail(res, error, 'start the load test');
  } finally {
    if (!started) releaseLoadSlot();
  }
});

router.get('/api/load-test-runs/:runId', requireRole('viewer'), async (req, res) => {
  try {
    const run = await withTenantTransaction(async (tx) => {
      await settleInterrupted(tx);
      const [row] = await tx.select(runColumns).from(loadTestRuns).where(eq(loadTestRuns.id, req.params.runId)).limit(1);
      return row;
    });
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    res.json(run);
  } catch (error) {
    fail(res, error, 'load the run');
  }
});

/** POST /api/load-test-runs/:runId/cancel — the runner stops at its next progress (2 s at most). */
router.post('/api/load-test-runs/:runId/cancel', requireRole('editor'), async (req, res) => {
  try {
    const run = await withTenantTransaction(async (tx) => {
      const [current] = await tx.select(runColumns).from(loadTestRuns).where(eq(loadTestRuns.id, req.params.runId)).limit(1);
      if (!current) throw new LoadError(404, 'Run not found.');
      await editableTest(tx, current.loadTestId);
      if (current.status !== 'running') throw new LoadError(409, 'The run is already over.');
      const [row] = await tx.update(loadTestRuns).set({ cancelRequested: true }).where(eq(loadTestRuns.id, current.id)).returning();
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
