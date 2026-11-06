import { asyncRouter } from '../../platform/middleware/async-router';
import { flattenZodError } from '../zod-error';
import { z } from 'zod';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { requireRole } from '../middleware/require-role';
import {
  AUDIT_ACTIONS,
  hubJobs,
  hubTestCases,
  hubWaveResults,
  hubWaves,
  reportTestCaseResults,
  testPlanSelectedTests,
  testPlans,
  type HubJob,
  type HubWave,
  type HubWaveResultRow,
} from '@shared/schema';
import {
  HUB_RESULT_STATUSES,
  HUB_WAVE_IMPORT_MAX_WAVES,
  HUB_WAVE_RESULTS_SCHEMA,
  emptyStatusCounts,
  waveRates,
  waveResultsFileName,
  wfmStatusToHub,
  type HubResultStatus,
  type HubStatusCounts,
} from '@shared/hub-waves';
import { readManualLog } from '@shared/manual-tests';
import { HubSourceError } from '../../integrations/testcases-hub';
import {
  WAVE_PLAN_PREFIX,
  materializeWave,
  startHubJob,
  syncWaves,
  waveReaderOf,
  type WaveActor,
  type WaveImportOutcome,
} from '../../integrations/hub-waves';
import { editableProject } from '../api-v1/authoring';
import { sessionRateLimit, sharedHeavyRateLimit } from '../middleware/rate-limits';
import { auditActor, recordAudit } from '../../tenancy/audit';
import { currentSource, sendHubError, tokenOf } from './testcase-hub.routes';

/**
 * QA hub waves (server/integrations/hub-waves.ts): the QA team's test sessions as the hub keeps
 * them, synced and imported as background jobs, and the views made of them — the waves with
 * their numbers, one wave by module, one case across waves, a new session from a wave, and the
 * export back in the hub's own format.
 */
const router = asyncRouter();

const readLimit = sessionRateLimit();
const heavyLimit = sharedHeavyRateLimit();

const statusSchema = z.enum(HUB_RESULT_STATUSES);
const csv = (max: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      (Array.isArray(value) ? value : value ? value.split(',') : [])
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, max),
    );

const importSchema = z.object({
  waveIds: z.array(z.number().int().positive()).min(1).max(HUB_WAVE_IMPORT_MAX_WAVES),
  projectId: z.number().int().positive().nullable().default(null),
  variant: z.enum(['standard', 'reference']).default('standard'),
});

const resultsQuerySchema = z.object({
  module: z.string().trim().max(200).optional(),
  status: statusSchema.optional(),
  tester: z.string().trim().max(200).optional(),
  stage: z.string().trim().max(8).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const sessionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  modules: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  stages: z.array(z.string().trim().min(1).max(8)).max(10).optional(),
  statuses: z.array(statusSchema).max(HUB_RESULT_STATUSES.length).optional(),
  testers: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
});

const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  module: z.string().trim().max(200).optional(),
  modules: csv(100),
});

function actorOf(req: Request): WaveActor {
  const user = req.user!;
  return {
    id: user.id,
    username: user.username,
    organizationId: user.organizationId,
    role: user.role,
    ip: req.ip ?? null,
  };
}

function waveIdParam(req: Request): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function requireSource() {
  const source = await currentSource();
  if (!source) throw new HubSourceError(404, 'no_source', 'No test case hub is configured.');
  return source;
}

/** What the client sees of a job. */
function toJob(row: HubJob) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    params: row.params,
    progress: row.progress,
    summary: row.summary,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    cancelRequested: row.cancelRequestedAt != null,
  };
}

/** Counts by status of every wave, or of one: one grouped query. */
async function countsByWave(waveRowIds: number[]) {
  const out = new Map<number, HubStatusCounts>();
  if (!waveRowIds.length) return out;
  const rows = await withTenantTransaction((tx) =>
    tx
      .select({
        waveRowId: hubWaveResults.waveRowId,
        status: hubWaveResults.status,
        n: sql<number>`count(*)::int`,
      })
      .from(hubWaveResults)
      .where(inArray(hubWaveResults.waveRowId, waveRowIds))
      .groupBy(hubWaveResults.waveRowId, hubWaveResults.status),
  );
  for (const row of rows) {
    const counts = out.get(row.waveRowId) ?? emptyStatusCounts();
    if (row.status in counts) counts[row.status as HubResultStatus] += Number(row.n);
    out.set(row.waveRowId, counts);
  }
  return out;
}

function toWave(row: HubWave, counts: HubStatusCounts) {
  const { fileHashes: _files, contentHash, materializedHash, ...visible } = row;
  return {
    ...visible,
    counts,
    rates: waveRates(counts),
    imported: row.executionId != null,
    changedSinceImport: row.executionId != null && materializedHash !== contentHash,
  };
}

/** Wave start date, newest first; a wave with no date last. */
const byStartDesc = [sql`${hubWaves.startDate} desc nulls last`, desc(hubWaves.id)];

// GET /api/testcase-hub/waves — every wave with its numbers.
router.get('/api/testcase-hub/waves', readLimit, requireRole('viewer'), async (_req, res) => {
  try {
    const waves = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(hubWaves)
        .orderBy(...byStartDesc),
    );
    const counts = await countsByWave(waves.map((wave) => wave.id));
    res.json(waves.map((wave) => toWave(wave, counts.get(wave.id) ?? emptyStatusCounts())));
  } catch (error) {
    sendHubError(res, error, 'Failed to load the waves.');
  }
});

// GET /api/testcase-hub/waves/overview — the dashboard: the trend over waves, and the modules.
router.get(
  '/api/testcase-hub/waves/overview',
  readLimit,
  requireRole('viewer'),
  async (_req, res) => {
    try {
      const { waves, modules, cases, latestJob } = await withTenantTransaction(async (tx) => {
        const waves = await tx
          .select()
          .from(hubWaves)
          .orderBy(asc(hubWaves.startDate), asc(hubWaves.id));
        const modules = await tx
          .select({
            module: hubWaveResults.module,
            status: hubWaveResults.status,
            n: sql<number>`count(*)::int`,
          })
          .from(hubWaveResults)
          .groupBy(hubWaveResults.module, hubWaveResults.status);
        const [cases] = await tx
          .select({ n: sql<number>`count(distinct ${hubWaveResults.caseId})::int` })
          .from(hubWaveResults);
        const [latestJob] = await tx
          .select()
          .from(hubJobs)
          .orderBy(desc(hubJobs.createdAt))
          .limit(1);
        return { waves, modules, cases, latestJob };
      });
      const counts = await countsByWave(waves.map((wave) => wave.id));
      const totals = emptyStatusCounts();
      const trend = waves.map((wave) => {
        const c = counts.get(wave.id) ?? emptyStatusCounts();
        for (const status of HUB_RESULT_STATUSES) totals[status] += c[status];
        return {
          id: wave.id,
          waveId: wave.waveId,
          name: wave.name,
          release: wave.release,
          waveType: wave.waveType,
          startDate: wave.startDate,
          counts: c,
          rates: waveRates(c),
        };
      });
      const byModule = new Map<string, HubStatusCounts>();
      for (const row of modules) {
        const key = row.module ?? '';
        const c = byModule.get(key) ?? emptyStatusCounts();
        if (row.status in c) c[row.status as HubResultStatus] += Number(row.n);
        byModule.set(key, c);
      }
      res.json({
        waves: waves.length,
        imported: waves.filter((wave) => wave.executionId != null).length,
        cases: Number(cases?.n ?? 0),
        totals,
        rates: waveRates(totals),
        trend,
        modules: Array.from(byModule, ([module, c]) => ({
          module: module || null,
          counts: c,
          rates: waveRates(c),
        })).sort((a, b) => (a.module ?? '').localeCompare(b.module ?? '')),
        lastJob: latestJob ? toJob(latestJob) : null,
      });
    } catch (error) {
      sendHubError(res, error, 'Failed to load the waves overview.');
    }
  },
);

// GET /api/testcase-hub/waves/cases/:caseId/history — one case across every wave.
router.get(
  '/api/testcase-hub/waves/cases/:caseId/history',
  readLimit,
  requireRole('viewer'),
  async (req, res) => {
    const caseId = String(req.params.caseId ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 64);
    try {
      const rows = await withTenantTransaction((tx) =>
        tx
          .select({
            waveRowId: hubWaves.id,
            waveId: hubWaves.waveId,
            name: hubWaves.name,
            release: hubWaves.release,
            waveType: hubWaves.waveType,
            startDate: hubWaves.startDate,
            executionId: hubWaves.executionId,
            result: hubWaveResults,
          })
          .from(hubWaveResults)
          .innerJoin(hubWaves, eq(hubWaves.id, hubWaveResults.waveRowId))
          .where(eq(hubWaveResults.caseId, caseId))
          .orderBy(...byStartDesc),
      );
      res.json(rows);
    } catch (error) {
      sendHubError(res, error, 'Failed to load the case history.');
    }
  },
);

async function loadWave(id: number): Promise<HubWave> {
  const [wave] = await withTenantTransaction((tx) =>
    tx.select().from(hubWaves).where(eq(hubWaves.id, id)).limit(1),
  );
  if (!wave) throw new HubSourceError(404, 'wave_not_found', 'The wave does not exist.');
  return wave;
}

// GET /api/testcase-hub/waves/:id — one wave: its numbers, by module, by tester.
router.get('/api/testcase-hub/waves/:id', readLimit, requireRole('viewer'), async (req, res) => {
  const id = waveIdParam(req);
  if (id == null) return res.status(400).json({ error: 'Invalid wave id' });
  try {
    const wave = await loadWave(id);
    const grouped = await withTenantTransaction((tx) =>
      tx
        .select({
          module: hubWaveResults.module,
          tester: sql<
            string | null
          >`coalesce(${hubWaveResults.executedBy}, ${hubWaveResults.assignedTester})`,
          status: hubWaveResults.status,
          n: sql<number>`count(*)::int`,
        })
        .from(hubWaveResults)
        .where(eq(hubWaveResults.waveRowId, id))
        .groupBy(
          hubWaveResults.module,
          sql`coalesce(${hubWaveResults.executedBy}, ${hubWaveResults.assignedTester})`,
          hubWaveResults.status,
        ),
    );
    const total = emptyStatusCounts();
    const modules = new Map<string, HubStatusCounts>();
    const testers = new Map<string, HubStatusCounts>();
    for (const row of grouped) {
      const status = row.status as HubResultStatus;
      if (!(status in total)) continue;
      const n = Number(row.n);
      total[status] += n;
      for (const [map, key] of [
        [modules, row.module ?? ''],
        [testers, row.tester ?? ''],
      ] as const) {
        const c = map.get(key) ?? emptyStatusCounts();
        c[status] += n;
        map.set(key, c);
      }
    }
    const list = (map: Map<string, HubStatusCounts>, field: 'module' | 'tester') =>
      Array.from(map, ([key, c]) => ({
        [field]: key || null,
        counts: c,
        rates: waveRates(c),
      })).sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')));
    res.json({
      ...toWave(wave, total),
      byModule: list(modules, 'module'),
      byTester: list(testers, 'tester'),
    });
  } catch (error) {
    sendHubError(res, error, 'Failed to load the wave.');
  }
});

// GET /api/testcase-hub/waves/:id/results — the cases of a wave, filtered and paged.
router.get(
  '/api/testcase-hub/waves/:id/results',
  readLimit,
  requireRole('viewer'),
  async (req, res) => {
    const id = waveIdParam(req);
    if (id == null) return res.status(400).json({ error: 'Invalid wave id' });
    const parsed = resultsQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Invalid query', details: flattenZodError(parsed.error) });
    const q = parsed.data;
    const where: SQL[] = [eq(hubWaveResults.waveRowId, id)];
    if (q.module) where.push(eq(hubWaveResults.module, q.module));
    if (q.status) where.push(eq(hubWaveResults.status, q.status));
    if (q.stage) where.push(eq(hubWaveResults.stage, q.stage.toUpperCase()));
    if (q.tester)
      where.push(
        or(eq(hubWaveResults.executedBy, q.tester), eq(hubWaveResults.assignedTester, q.tester))!,
      );
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        or(
          ilike(hubWaveResults.caseId, like),
          ilike(hubWaveResults.notes, like),
          ilike(hubWaveResults.bugReference, like),
          ilike(hubTestCases.featureHighlight, like),
          ilike(hubTestCases.functionalObjective, like),
        )!,
      );
    }
    try {
      await loadWave(id);
      const { rows, total } = await withTenantTransaction(async (tx) => {
        const [counted] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(hubWaveResults)
          .leftJoin(hubTestCases, eq(hubTestCases.caseId, hubWaveResults.caseId))
          .where(and(...where));
        const rows = await tx
          .select({
            result: hubWaveResults,
            featureHighlight: hubTestCases.featureHighlight,
            objective: hubTestCases.functionalObjective,
            testId: hubTestCases.testId,
            inCatalog: sql<boolean>`${hubTestCases.id} is not null`,
          })
          .from(hubWaveResults)
          .leftJoin(hubTestCases, eq(hubTestCases.caseId, hubWaveResults.caseId))
          .where(and(...where))
          .orderBy(asc(hubWaveResults.module), asc(hubWaveResults.caseId))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize);
        return { rows, total: Number(counted?.n ?? 0) };
      });
      res.json({
        total,
        page: q.page,
        pageSize: q.pageSize,
        results: rows.map((row) => ({
          ...row.result,
          featureHighlight: row.featureHighlight,
          objective: row.objective,
          testId: row.testId,
          inCatalog: row.inCatalog,
        })),
      });
    } catch (error) {
      sendHubError(res, error, 'Failed to load the wave results.');
    }
  },
);

// POST /api/testcase-hub/waves/sync — read the waves of the hub again (a background job).
router.post('/api/testcase-hub/waves/sync', heavyLimit, requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const source = await requireSource();
    // The token is read and the reader built now, so a source that cannot be reached is told
    // to the person who asked rather than written into a job they may never look at.
    const reader = await waveReaderOf(source, { token: await tokenOf(source) });
    const actor = actorOf(req);
    const job = await startHubJob(actor, source.id, 'waves_sync', {}, async (hooks) => {
      const outcome = await syncWaves(source, reader, hooks);
      await withTenantTransaction((tx) =>
        recordAudit(tx, {
          action: AUDIT_ACTIONS.TESTCASE_HUB_WAVES_SYNCED,
          actor: { id: actor.id, username: actor.username, apiKeyId: null, ipAddress: actor.ip },
          targetType: 'testcase_hub',
          targetId: source.id,
          metadata: { ...outcome, warnings: outcome.warnings.length },
        }),
      );
      return { ...outcome, warnings: outcome.warnings.slice(0, 50) };
    });
    res.status(202).json(job);
  } catch (error) {
    sendHubError(res, error, 'Failed to start the waves sync.');
  }
});

// POST /api/testcase-hub/waves/import — chosen waves become plans and runs (a background job).
router.post(
  '/api/testcase-hub/waves/import',
  heavyLimit,
  requireRole('editor'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
    const params = parsed.data;
    try {
      const source = await requireSource();
      const waves = await withTenantTransaction(async (tx) => {
        await editableProject(tx, req, params.projectId);
        return tx
          .select({ id: hubWaves.id, waveId: hubWaves.waveId })
          .from(hubWaves)
          .where(inArray(hubWaves.id, params.waveIds));
      });
      if (waves.length !== new Set(params.waveIds).size)
        throw new HubSourceError(404, 'wave_not_found', 'One or more waves do not exist.');
      const actor = actorOf(req);
      const job = await startHubJob(
        actor,
        source.id,
        'wave_import',
        { ...params },
        async (hooks) => {
          const outcomes: WaveImportOutcome[] = [];
          for (const [index, wave] of waves.entries()) {
            await hooks.progress?.(index, waves.length, wave.waveId);
            outcomes.push(
              await materializeWave(actor, wave.id, params, {
                cancelled: hooks.cancelled,
                // Within a wave the progress is of its cases; the job reports waves.
                progress: (done, total) =>
                  hooks.progress?.(index + (total ? done / total : 0), waves.length, wave.waveId),
              }),
            );
          }
          await withTenantTransaction((tx) =>
            recordAudit(tx, {
              action: AUDIT_ACTIONS.TESTCASE_HUB_WAVES_IMPORTED,
              actor: {
                id: actor.id,
                username: actor.username,
                apiKeyId: null,
                ipAddress: actor.ip,
              },
              targetType: 'testcase_hub',
              targetId: source.id,
              metadata: {
                waves: outcomes.map((o) => o.waveId),
                projectId: params.projectId,
                imported: outcomes.reduce((sum, o) => sum + o.imported, 0),
                results: outcomes.reduce((sum, o) => sum + o.results, 0),
              },
            }),
          );
          return { waves: outcomes };
        },
      );
      res.status(202).json(job);
    } catch (error) {
      sendHubError(res, error, 'Failed to start the wave import.');
    }
  },
);

// GET /api/testcase-hub/jobs — the latest jobs of the hub.
router.get('/api/testcase-hub/jobs', readLimit, requireRole('viewer'), async (_req, res) => {
  try {
    const rows = await withTenantTransaction((tx) =>
      tx.select().from(hubJobs).orderBy(desc(hubJobs.createdAt)).limit(20),
    );
    res.json(rows.map(toJob));
  } catch (error) {
    sendHubError(res, error, 'Failed to load the jobs.');
  }
});

// GET /api/testcase-hub/jobs/:id — one job, polled while it runs.
router.get('/api/testcase-hub/jobs/:id', readLimit, requireRole('viewer'), async (req, res) => {
  try {
    const [row] = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(hubJobs)
        .where(eq(hubJobs.id, String(req.params.id)))
        .limit(1),
    );
    if (!row) return res.status(404).json({ error: 'Job not found.' });
    res.json(toJob(row));
  } catch (error) {
    sendHubError(res, error, 'Failed to load the job.');
  }
});

// POST /api/testcase-hub/jobs/:id/cancel — ask a live job to stop at its next step.
router.post(
  '/api/testcase-hub/jobs/:id/cancel',
  heavyLimit,
  requireRole('editor'),
  async (req, res) => {
    try {
      const [row] = await withTenantTransaction((tx) =>
        tx
          .update(hubJobs)
          .set({ cancelRequestedAt: new Date() })
          .where(
            and(
              eq(hubJobs.id, String(req.params.id)),
              inArray(hubJobs.status, ['queued', 'running']),
            ),
          )
          .returning(),
      );
      if (!row) return res.status(409).json({ error: 'The job is not running.' });
      res.json(toJob(row));
    } catch (error) {
      sendHubError(res, error, 'Failed to cancel the job.');
    }
  },
);

// POST /api/testcase-hub/waves/:id/session — a new plan of the wave's cases, to run them again.
router.post(
  '/api/testcase-hub/waves/:id/session',
  heavyLimit,
  requireRole('editor'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const id = waveIdParam(req);
    if (id == null) return res.status(400).json({ error: 'Invalid wave id' });
    const parsed = sessionSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
    const f = parsed.data;
    try {
      const wave = await loadWave(id);
      const result = await withTenantTransaction(async (tx) => {
        const where: SQL[] = [eq(hubWaveResults.waveRowId, id)];
        if (f.modules?.length) where.push(inArray(hubWaveResults.module, f.modules));
        if (f.stages?.length)
          where.push(
            inArray(
              hubWaveResults.stage,
              f.stages.map((s) => s.toUpperCase()),
            ),
          );
        if (f.statuses?.length) where.push(inArray(hubWaveResults.status, f.statuses));
        if (f.testers?.length)
          where.push(
            or(
              inArray(hubWaveResults.executedBy, f.testers),
              inArray(hubWaveResults.assignedTester, f.testers),
            )!,
          );
        const rows = await tx
          .select({ caseId: hubWaveResults.caseId, testId: hubTestCases.testId })
          .from(hubWaveResults)
          .leftJoin(hubTestCases, eq(hubTestCases.caseId, hubWaveResults.caseId))
          .where(and(...where))
          .orderBy(asc(hubWaveResults.id));
        const testIds = Array.from(
          new Set(rows.map((row) => row.testId).filter((t): t is number => t != null)),
        );
        if (!testIds.length)
          throw new HubSourceError(
            409,
            'no_linked_tests',
            'None of the chosen cases is a test yet: import the wave first.',
          );
        const name =
          f.name ??
          `${WAVE_PLAN_PREFIX}${wave.name} · re-run ${new Date().toISOString().slice(0, 10)}`;
        const planId = randomUUID();
        await tx.insert(testPlans).values({
          id: planId,
          userId: req.user!.id,
          organizationId: req.user!.organizationId,
          name: name.slice(0, 200),
          description: `Cases of the QA hub wave ${wave.waveId}, to run again.`,
          testMachinesConfig: null,
          notificationSettings: null,
        });
        for (let start = 0; start < testIds.length; start += 500)
          await tx.insert(testPlanSelectedTests).values(
            testIds.slice(start, start + 500).map((testId) => ({
              testPlanId: planId,
              organizationId: req.user!.organizationId,
              testId,
              apiTestId: null,
              mobileTestId: null,
              testType: 'ui',
            })),
          );
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PLAN_CREATED,
          actor: auditActor(req),
          targetType: 'test_plan',
          targetId: planId,
          metadata: { name, tests: testIds.length, hubWave: wave.waveId },
        });
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TESTCASE_HUB_WAVE_SESSION_CREATED,
          actor: auditActor(req),
          targetType: 'test_plan',
          targetId: planId,
          metadata: { waveId: wave.waveId, filters: f, tests: testIds.length },
        });
        return {
          testPlanId: planId,
          name,
          tests: testIds.length,
          notImported: rows.filter((row) => row.testId == null).length,
        };
      });
      res.status(201).json(result);
    } catch (error) {
      sendHubError(res, error, 'Failed to create the session.');
    }
  },
);

// ─── Export ────────────────────────────────────────────────────────────────────

interface ExportRow {
  caseId: string;
  rawCaseId: string;
  module: string | null;
  status: HubResultStatus;
  tester: string | null;
  executionDate: string | null;
  buildNumber: string | null;
  bugReference: string | null;
  bugPriority: string | null;
  notes: string | null;
  attempts: HubWaveResultRow['attempts'];
  /** Whether the result is a verdict given in WFM after the import. */
  fromWfm: boolean;
}

/**
 * The wave as it stands: the hub's results, with every verdict given in WFM since the import put
 * over them as one more execution — the way the desktop app records a re-test.
 */
async function exportRows(wave: HubWave): Promise<ExportRow[]> {
  return withTenantTransaction(async (tx) => {
    const results = await tx
      .select()
      .from(hubWaveResults)
      .where(eq(hubWaveResults.waveRowId, wave.id))
      .orderBy(asc(hubWaveResults.module), asc(hubWaveResults.caseId));
    const rows: ExportRow[] = results.map((row) => ({
      caseId: row.caseId,
      rawCaseId: row.rawCaseId,
      module: row.module,
      status: row.status,
      tester: row.executedBy,
      executionDate: row.executionDate,
      buildNumber: row.buildNumber,
      bugReference: row.bugReference,
      bugPriority: row.bugPriority,
      notes: row.notes,
      attempts: row.attempts,
      fromWfm: false,
    }));
    if (!wave.executionId) return rows;
    const byCase = new Map(rows.map((row) => [row.caseId, row]));
    const linked = await tx
      .select({ caseId: hubTestCases.caseId, testId: hubTestCases.testId })
      .from(hubTestCases)
      .where(
        and(
          isNotNull(hubTestCases.testId),
          inArray(
            hubTestCases.caseId,
            rows.map((row) => row.caseId),
          ),
        ),
      );
    const caseOfTest = new Map(linked.map((row) => [row.testId!, row.caseId]));
    const run = await tx
      .select({
        uiTestId: reportTestCaseResults.uiTestId,
        testName: reportTestCaseResults.testName,
        status: reportTestCaseResults.status,
        detailedLog: reportTestCaseResults.detailedLog,
      })
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, wave.executionId));
    for (const result of run) {
      const log = readManualLog(result.detailedLog);
      if (!log?.verdict || log.verdict.imported) continue;
      const caseId =
        (result.uiTestId != null ? caseOfTest.get(result.uiTestId) : null) ?? result.testName;
      const row = byCase.get(caseId);
      if (!row) continue;
      const status = wfmStatusToHub(result.status, log.verdict.outcome);
      const executionDate = log.verdict.at.slice(0, 10);
      row.status = status;
      row.tester = log.verdict.byUsername;
      row.executionDate = executionDate;
      row.notes = log.verdict.notes;
      row.fromWfm = true;
      row.attempts = [
        ...row.attempts,
        {
          number: (row.attempts.at(-1)?.number ?? 0) + 1,
          status,
          tester: log.verdict.byUsername,
          executionDate,
          buildNumber: row.buildNumber,
          bugReference: row.bugReference,
          bugPriority: row.bugPriority,
          notes: log.verdict.notes,
        },
      ];
    }
    return rows;
  });
}

function toHubResultsFile(waveId: string, module: string | null, rows: ExportRow[]) {
  return {
    schema_version: HUB_WAVE_RESULTS_SCHEMA,
    wave_id: waveId,
    module,
    results: rows.map((row) => ({
      tc_id: row.rawCaseId,
      execution_status: row.status,
      tester: row.tester,
      execution_date: row.executionDate,
      build_number: row.buildNumber,
      bug_reference: row.bugReference,
      bug_priority: row.bugPriority,
      notes: row.notes,
      executions: row.attempts.map((attempt) => ({
        execution_number: attempt.number,
        execution_status: attempt.status,
        tester: attempt.tester,
        execution_date: attempt.executionDate,
        build_number: attempt.buildNumber,
        bug_reference: attempt.bugReference,
        bug_priority: attempt.bugPriority,
        notes: attempt.notes,
      })),
    })),
  };
}

/** A CSV cell: quoted, and never read as a formula by a spreadsheet. */
function cell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

// GET /api/testcase-hub/waves/:id/export — the results back in the hub's format, or as CSV.
router.get(
  '/api/testcase-hub/waves/:id/export',
  readLimit,
  requireRole('viewer'),
  async (req, res) => {
    const id = waveIdParam(req);
    if (id == null) return res.status(400).json({ error: 'Invalid wave id' });
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Invalid query', details: flattenZodError(parsed.error) });
    try {
      const wave = await loadWave(id);
      const rows = await exportRows(wave);
      const safeId = wave.waveId.replace(/[^\w.-]+/g, '_');
      if (parsed.data.format === 'csv') {
        const wanted = new Set(parsed.data.modules);
        const header = [
          'wave_id',
          'module',
          'tc_id',
          'execution_status',
          'tester',
          'execution_date',
          'build_number',
          'bug_reference',
          'bug_priority',
          'notes',
          'executions',
          'from_wfm',
        ];
        const lines = [header.map(cell).join(',')];
        for (const row of rows) {
          if (wanted.size && !wanted.has(row.module ?? '')) continue;
          lines.push(
            [
              wave.waveId,
              row.module,
              row.rawCaseId,
              row.status,
              row.tester,
              row.executionDate,
              row.buildNumber,
              row.bugReference,
              row.bugPriority,
              row.notes,
              row.attempts.length,
              row.fromWfm ? 'yes' : 'no',
            ]
              .map(cell)
              .join(','),
          );
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeId}_results.csv"`);
        return res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
      }
      // The hub keeps one results file per module: the JSON export is one of them.
      const module = parsed.data.module;
      if (!module)
        return res
          .status(400)
          .json({ error: 'Choose the module: the hub keeps one results file per module.' });
      const file = toHubResultsFile(
        wave.waveId,
        module,
        rows.filter((row) => row.module === module),
      );
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${waveResultsFileName(module).replace(/[^\w.-]+/g, '_')}"`,
      );
      res.send(JSON.stringify(file, null, 2));
    } catch (error) {
      sendHubError(res, error, 'Failed to export the wave.');
    }
  },
);

export default router;
