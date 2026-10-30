import { asyncRouter } from '../../platform/middleware/async-router';
import { flattenZodError } from '../zod-error';
import { z } from 'zod';
import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { requireRole } from '../middleware/require-role';
import { decryptSecret, encryptSecret } from '../../platform/crypto';
import {
  AUDIT_ACTIONS,
  hubTestCases,
  testCaseSources,
  tests,
  type TestCaseSource,
} from '@shared/schema';
import { HUB_IMPORT_MAX_CASES, hubCaseToManualSteps, hubTestName } from '@shared/testcases-hub';
import {
  HubSourceError,
  checkSource,
  importCases,
  logWarnings,
  readSource,
  resolveHubFolder,
  writeCatalog,
} from '../../integrations/testcases-hub';
import logger from '../../platform/logger';
import { AuthoringError } from '../api-v1/authoring';
import { auditActor, changedFields, recordAudit } from '../../tenancy/audit';

/**
 * The QA test case hub: one source per organization, its catalog, and the import that turns
 * chosen cases into manual tests. The token of an Azure DevOps source is stored encrypted and
 * never returned; a folder source may only point under TESTCASE_HUB_ROOTS.
 */
const router = asyncRouter();

const folderSchema = z.object({
  kind: z.literal('folder'),
  name: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1).max(1024),
});

const azureDevOpsSchema = z.object({
  kind: z.literal('azure-devops'),
  name: z.string().trim().min(1).max(120),
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(512)
    .refine((value) => /^https?:\/\//i.test(value), 'The URL must start with http(s)://'),
  project: z.string().trim().min(1).max(256),
  repository: z.string().trim().min(1).max(256),
  branch: z.string().trim().min(1).max(256).default('main'),
  /** Omitted on an update keeps the saved token. */
  token: z.string().min(1).max(4096).optional(),
});

const sourceSchema = z.discriminatedUnion('kind', [folderSchema, azureDevOpsSchema]);

const listQuerySchema = z.object({
  module: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'deprecated', 'all']).default('active'),
  priority: z.string().trim().max(40).optional(),
  readiness: z.coerce.number().int().min(0).max(5).optional(),
  q: z.string().trim().max(200).optional(),
  imported: z.enum(['yes', 'no', 'changed', 'all']).default('all'),
  missing: z.enum(['include', 'exclude', 'only']).default('exclude'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const importSchema = z.object({
  caseIds: z.array(z.string().trim().min(1).max(64)).min(1).max(HUB_IMPORT_MAX_CASES),
  projectId: z.number().int().positive().nullable().default(null),
  suiteId: z.number().int().positive().nullable().optional(),
  newSuiteName: z.string().trim().min(1).max(120).nullable().optional(),
  variant: z.enum(['standard', 'reference']).default('standard'),
});

/** What the client sees of a source: everything but the token. */
function toSummary(row: TestCaseSource) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    path: row.kind === 'folder' ? row.path : null,
    baseUrl: row.kind === 'azure-devops' ? row.baseUrl : null,
    project: row.kind === 'azure-devops' ? row.project : null,
    repository: row.kind === 'azure-devops' ? row.repository : null,
    branch: row.kind === 'azure-devops' ? row.branch : null,
    hasToken: row.encryptedToken != null,
    lastRefreshAt: row.lastRefreshAt,
    lastRefreshHead: row.lastRefreshHead,
    lastRefreshStatus: row.lastRefreshStatus,
    lastRefreshError: row.lastRefreshError,
    caseCount: row.caseCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function currentSource(): Promise<TestCaseSource | null> {
  const [row] = await withTenantTransaction((tx) => tx.select().from(testCaseSources).limit(1));
  return row ?? null;
}

async function tokenOf(source: TestCaseSource): Promise<string | null> {
  if (!source.encryptedToken || !source.tokenIv || !source.tokenAuthTag) return null;
  return decryptSecret(
    source.encryptedToken,
    source.tokenIv,
    source.tokenAuthTag,
    source.organizationId,
  );
}

function sendHubError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof HubSourceError || error instanceof AuthoringError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  logger.error({ message: fallback, error: (error as Error)?.message ?? String(error) });
  res.status(500).json({ error: fallback });
}

// GET /api/testcase-hub — the organization's source, or null.
router.get('/api/testcase-hub', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const source = await currentSource();
    res.json(source ? toSummary(source) : null);
  } catch (error) {
    sendHubError(res, error, 'Failed to load the test case hub.');
  }
});

// PUT /api/testcase-hub — create or replace the organization's source.
router.put('/api/testcase-hub', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = sourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
  }
  const input = parsed.data;
  const organizationId = req.user.organizationId;
  try {
    const existing = await currentSource();
    if (input.kind === 'folder') {
      // Refused here, before anything is saved, so that the catalog never holds a path the
      // operator did not allow.
      await resolveHubFolder(input.path);
    }
    let token: { encryptedValue: string; iv: string; authTag: string } | null = null;
    if (input.kind === 'azure-devops') {
      if (input.token) token = await encryptSecret(input.token, organizationId);
      else if (!existing || existing.kind !== 'azure-devops' || !existing.encryptedToken)
        return res.status(400).json({ error: 'The Azure DevOps source needs a token.' });
    }
    const values = {
      kind: input.kind,
      name: input.name,
      path: input.kind === 'folder' ? input.path : null,
      baseUrl: input.kind === 'azure-devops' ? input.baseUrl.replace(/\/+$/, '') : null,
      project: input.kind === 'azure-devops' ? input.project : null,
      repository: input.kind === 'azure-devops' ? input.repository : null,
      branch: input.kind === 'azure-devops' ? input.branch : null,
      ...(input.kind === 'folder'
        ? { encryptedToken: null, tokenIv: null, tokenAuthTag: null }
        : token
          ? { encryptedToken: token.encryptedValue, tokenIv: token.iv, tokenAuthTag: token.authTag }
          : {}),
      updatedAt: new Date(),
    };
    const saved = await withTenantTransaction(async (tx) => {
      if (existing) {
        const kindChanged = existing.kind !== input.kind;
        const locationChanged =
          existing.path !== values.path ||
          existing.baseUrl !== values.baseUrl ||
          existing.project !== values.project ||
          existing.repository !== values.repository ||
          existing.branch !== values.branch;
        const [row] = await tx
          .update(testCaseSources)
          .set({
            ...values,
            // A catalog read from somewhere else says nothing about the new place.
            ...(kindChanged || locationChanged
              ? {
                  lastRefreshAt: null,
                  lastRefreshHead: null,
                  lastRefreshStatus: null,
                  lastRefreshError: null,
                  caseCount: 0,
                }
              : {}),
          })
          .where(eq(testCaseSources.id, existing.id))
          .returning();
        if (kindChanged || locationChanged) {
          await tx.delete(hubTestCases).where(eq(hubTestCases.sourceId, existing.id));
        }
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TESTCASE_HUB_UPDATED,
          actor: auditActor(req),
          targetType: 'testcase_hub',
          targetId: row.id,
          // The fields touched, never their values: the path and the token stay out of the log.
          metadata: { name: row.name, kind: row.kind, fields: changedFields(req.body) },
        });
        return row;
      }
      const [row] = await tx
        .insert(testCaseSources)
        .values({ id: uuidv4(), organizationId, createdBy: req.user!.id, ...values })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TESTCASE_HUB_CONFIGURED,
        actor: auditActor(req),
        targetType: 'testcase_hub',
        targetId: row.id,
        metadata: { name: row.name, kind: row.kind },
      });
      return row;
    });
    res.status(existing ? 200 : 201).json(toSummary(saved));
  } catch (error) {
    sendHubError(res, error, 'Failed to save the test case hub.');
  }
});

// DELETE /api/testcase-hub — forget the source and its catalog; the imported tests stay.
router.delete('/api/testcase-hub', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const removed = await withTenantTransaction(async (tx) => {
      const [row] = await tx.select().from(testCaseSources).limit(1);
      if (!row) return null;
      await tx.delete(hubTestCases).where(eq(hubTestCases.sourceId, row.id));
      await tx.delete(testCaseSources).where(eq(testCaseSources.id, row.id));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TESTCASE_HUB_REMOVED,
        actor: auditActor(req),
        targetType: 'testcase_hub',
        targetId: row.id,
        metadata: { name: row.name, kind: row.kind },
      });
      return row;
    });
    if (!removed) return res.status(404).json({ error: 'No test case hub is configured.' });
    res.status(204).end();
  } catch (error) {
    sendHubError(res, error, 'Failed to remove the test case hub.');
  }
});

// POST /api/testcase-hub/test — can the saved source be read?
router.post('/api/testcase-hub/test', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const source = await currentSource();
    if (!source) return res.status(404).json({ error: 'No test case hub is configured.' });
    const token = await tokenOf(source);
    res.json(await checkSource(source, { token }));
  } catch (error) {
    sendHubError(res, error, 'Failed to test the test case hub.');
  }
});

// POST /api/testcase-hub/refresh — read the hub and rewrite the catalog.
router.post('/api/testcase-hub/refresh', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const source = await currentSource();
    if (!source) return res.status(404).json({ error: 'No test case hub is configured.' });
    // The read happens outside the transaction: a folder of 19 000 files or a few hundred HTTP
    // calls must not hold a database connection open.
    let snapshot;
    try {
      const token = await tokenOf(source);
      snapshot = await readSource(source, { token });
    } catch (error) {
      const message =
        error instanceof HubSourceError ? error.message : 'The hub could not be read.';
      await withTenantTransaction(async (tx) => {
        await tx
          .update(testCaseSources)
          .set({ lastRefreshStatus: 'failed', lastRefreshError: message, updatedAt: new Date() })
          .where(eq(testCaseSources.id, source.id));
      });
      throw error;
    }
    const { outcome, updatedSource } = await withTenantTransaction(async (tx) => {
      const outcome = await writeCatalog(tx, source, snapshot);
      const [updatedSource] = await tx
        .update(testCaseSources)
        .set({
          lastRefreshAt: new Date(),
          lastRefreshHead: outcome.head,
          lastRefreshStatus: 'ok',
          lastRefreshError: null,
          caseCount: outcome.cases,
          updatedAt: new Date(),
        })
        .where(eq(testCaseSources.id, source.id))
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TESTCASE_HUB_REFRESHED,
        actor: auditActor(req),
        targetType: 'testcase_hub',
        targetId: source.id,
        metadata: {
          cases: outcome.cases,
          added: outcome.added,
          updated: outcome.updated,
          missing: outcome.missing,
          head: outcome.head,
        },
      });
      return { outcome, updatedSource };
    });
    logWarnings(source.id, outcome.warnings);
    res.json({
      source: toSummary(updatedSource),
      cases: outcome.cases,
      added: outcome.added,
      updated: outcome.updated,
      missing: outcome.missing,
      head: outcome.head,
      warnings: outcome.warnings.length,
      warningSample: outcome.warnings.slice(0, 5),
    });
  } catch (error) {
    sendHubError(res, error, 'Failed to refresh the test case hub.');
  }
});

/** The row as the catalog table shows it: the long texts stay out of the list. */
const listedColumns = {
  id: hubTestCases.id,
  caseId: hubTestCases.caseId,
  module: hubTestCases.module,
  executionModule: hubTestCases.executionModule,
  status: hubTestCases.status,
  priority: hubTestCases.priority,
  readinessLevel: hubTestCases.readinessLevel,
  versionFrom: hubTestCases.versionFrom,
  versionTo: hubTestCases.versionTo,
  featureHighlight: hubTestCases.featureHighlight,
  executionGroup: hubTestCases.executionGroup,
  functionalObjective: hubTestCases.functionalObjective,
  dependsOn: hubTestCases.dependsOn,
  sourceUpdatedAt: hubTestCases.sourceUpdatedAt,
  missingSince: hubTestCases.missingSince,
  testId: hubTestCases.testId,
  importedAt: hubTestCases.importedAt,
  changedSinceImport: sql<boolean>`${hubTestCases.importedHash} is not null and ${hubTestCases.importedHash} <> ${hubTestCases.contentHash}`,
};

function listFilters(query: z.infer<typeof listQuerySchema>): SQL[] {
  const filters: SQL[] = [];
  if (query.module) filters.push(eq(hubTestCases.module, query.module));
  if (query.status !== 'all') filters.push(eq(hubTestCases.status, query.status));
  if (query.priority) filters.push(eq(hubTestCases.priority, query.priority));
  if (query.readiness !== undefined) filters.push(eq(hubTestCases.readinessLevel, query.readiness));
  if (query.missing === 'exclude') filters.push(isNull(hubTestCases.missingSince));
  if (query.missing === 'only') filters.push(sql`${hubTestCases.missingSince} is not null`);
  if (query.imported === 'yes') filters.push(sql`${hubTestCases.testId} is not null`);
  if (query.imported === 'no') filters.push(isNull(hubTestCases.testId));
  if (query.imported === 'changed') filters.push(listedColumns.changedSinceImport);
  if (query.q) {
    const needle = `%${query.q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    filters.push(
      or(
        ilike(hubTestCases.caseId, needle),
        ilike(hubTestCases.functionalObjective, needle),
        ilike(hubTestCases.featureHighlight, needle),
        ilike(hubTestCases.steps, needle),
      )!,
    );
  }
  return filters;
}

// GET /api/testcase-hub/cases — the catalog, filtered and paged.
router.get('/api/testcase-hub/cases', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', details: flattenZodError(parsed.error) });
  }
  const query = parsed.data;
  try {
    const where = and(...listFilters(query));
    const { rows, total } = await withTenantTransaction(async (tx) => {
      const [count] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(hubTestCases)
        .where(where);
      const rows = await tx
        .select(listedColumns)
        .from(hubTestCases)
        .where(where)
        .orderBy(asc(hubTestCases.module), asc(hubTestCases.caseId))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return { rows, total: Number(count?.total ?? 0) };
    });
    res.json({ rows, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    sendHubError(res, error, 'Failed to load the test case catalog.');
  }
});

// GET /api/testcase-hub/facets — what the filters can be set to, with counts.
router.get('/api/testcase-hub/facets', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const facets = await withTenantTransaction(async (tx) => {
      const present = isNull(hubTestCases.missingSince);
      const modules = await tx
        .select({ value: hubTestCases.module, count: sql<number>`count(*)` })
        .from(hubTestCases)
        .where(present)
        .groupBy(hubTestCases.module)
        .orderBy(asc(hubTestCases.module));
      const statuses = await tx
        .select({ value: hubTestCases.status, count: sql<number>`count(*)` })
        .from(hubTestCases)
        .where(present)
        .groupBy(hubTestCases.status)
        .orderBy(asc(hubTestCases.status));
      const priorities = await tx
        .select({ value: hubTestCases.priority, count: sql<number>`count(*)` })
        .from(hubTestCases)
        .where(present)
        .groupBy(hubTestCases.priority)
        .orderBy(desc(sql`count(*)`));
      const readiness = await tx
        .select({ value: hubTestCases.readinessLevel, count: sql<number>`count(*)` })
        .from(hubTestCases)
        .where(present)
        .groupBy(hubTestCases.readinessLevel)
        .orderBy(asc(hubTestCases.readinessLevel));
      const [totals] = await tx
        .select({
          total: sql<number>`count(*)`,
          imported: sql<number>`count(*) filter (where ${hubTestCases.testId} is not null)`,
          changed: sql<number>`count(*) filter (where ${listedColumns.changedSinceImport})`,
          missing: sql<number>`count(*) filter (where ${hubTestCases.missingSince} is not null)`,
        })
        .from(hubTestCases);
      const asCounts = <T>(rows: { value: T; count: number }[]) =>
        rows.map((row) => ({ value: row.value, count: Number(row.count) }));
      return {
        modules: asCounts(modules),
        statuses: asCounts(statuses),
        priorities: asCounts(priorities),
        readiness: asCounts(readiness),
        total: Number(totals?.total ?? 0),
        imported: Number(totals?.imported ?? 0),
        changed: Number(totals?.changed ?? 0),
        missing: Number(totals?.missing ?? 0),
      };
    });
    res.json(facets);
  } catch (error) {
    sendHubError(res, error, 'Failed to load the test case catalog.');
  }
});

// GET /api/testcase-hub/cases/:caseId — one case, with the steps it would become.
router.get('/api/testcase-hub/cases/:caseId', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const caseId = String(req.params.caseId ?? '')
    .trim()
    .toUpperCase();
  if (!caseId) return res.status(400).json({ error: 'Invalid case id' });
  try {
    const found = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(hubTestCases)
        .where(eq(hubTestCases.caseId, caseId))
        .limit(1);
      if (!row) return null;
      const [test] = row.testId
        ? await tx
            .select({ id: tests.id, name: tests.name, updatedAt: tests.updatedAt })
            .from(tests)
            .where(eq(tests.id, row.testId))
            .limit(1)
        : [];
      return { row, test: test ?? null };
    });
    if (!found) return res.status(404).json({ error: 'The case is not in the catalog.' });
    const { row, test } = found;
    const definition = {
      ...row,
      dependsOn: row.dependsOn ?? [],
      sourceUpdatedAt: row.sourceUpdatedAt ? row.sourceUpdatedAt.toISOString() : null,
    };
    const { contentHash, importedHash, ...visible } = row;
    res.json({
      ...visible,
      changedSinceImport: importedHash != null && importedHash !== contentHash,
      test,
      testName: hubTestName(definition),
      preview: {
        standard: hubCaseToManualSteps(definition),
        reference: row.refEnvSteps
          ? hubCaseToManualSteps(definition, { variant: 'reference' })
          : null,
      },
    });
  } catch (error) {
    sendHubError(res, error, 'Failed to load the test case.');
  }
});

// POST /api/testcase-hub/import — the chosen cases become manual tests.
router.post('/api/testcase-hub/import', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
  }
  if (parsed.data.suiteId != null && parsed.data.newSuiteName)
    return res.status(400).json({ error: 'Choose an existing suite or a new one, not both.' });
  const caseIds = parsed.data.caseIds.map((id) => id.toUpperCase());
  try {
    const result = await withTenantTransaction(async (tx) => {
      const [source] = await tx.select({ id: testCaseSources.id }).from(testCaseSources).limit(1);
      if (!source) throw new HubSourceError(404, 'no_source', 'No test case hub is configured.');
      const known = await tx
        .select({ caseId: hubTestCases.caseId })
        .from(hubTestCases)
        .where(inArray(hubTestCases.caseId, caseIds));
      const knownIds = new Set(known.map((row) => row.caseId));
      const unknown = caseIds.filter((id) => !knownIds.has(id));
      if (unknown.length)
        throw new HubSourceError(
          404,
          'case_not_in_catalog',
          `Not in the catalog: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}.`,
        );
      const result = await importCases(tx, req, { ...parsed.data, caseIds });
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TESTCASE_HUB_IMPORTED,
        actor: auditActor(req),
        targetType: 'testcase_hub',
        targetId: source.id,
        metadata: {
          requested: caseIds.length,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped,
          projectId: parsed.data.projectId,
          suiteId: result.suiteId,
        },
      });
      return result;
    });
    res.json(result);
  } catch (error) {
    sendHubError(res, error, 'Failed to import the test cases.');
  }
});

export default router;
