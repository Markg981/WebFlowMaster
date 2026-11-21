import { asyncRouter } from '../../platform/middleware/async-router';
import { flattenZodError } from '../zod-error';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  AUDIT_ACTIONS,
  DATA_FIXTURE_KEY_PATTERN,
  FIXTURE_LEDGER_STATUSES,
  LibraryFixtureDefinitionSchema,
  dataFixtureLibrary,
  dataFixtureVersions,
  projects,
  testVersions,
  tests,
  type DataFixtureRef,
  type FixtureLedgerStatus,
  type LibraryFixture,
} from '@shared/schema';
import { partialUpdate } from '@shared/partial-update';
import { withTenantTransaction, type TenantTx } from '../../platform/middleware/tenancy';
import { requireRole } from '../middleware/require-role';
import { sessionRateLimit, sharedHeavyRateLimit } from '../middleware/rate-limits';
import { auditActor, recordAudit } from '../../tenancy/audit';
import {
  FixtureGraphError,
  checkLibraryFixture,
  expandDataFixtures,
  libraryLoader,
} from '../../authoring/fixture-graph';
import { environmentAllowsDataSetup, resolveVariables } from '../../runtime/variables';
import { runVariables } from '../../execution/plan-run/inputs';
import { runDataFixtures } from '../../runtime/data-setup/fixture-runner';
import { listLedger, retryLedgerRow } from '../../runtime/data-setup/fixture-ledger';
import logger from '../../platform/logger';

/**
 * The data fixture library of a project (shared/schema/data-fixtures.ts): fixtures kept once and
 * named by the tests that need them. Saving a new definition adds a version; a version is never
 * changed, because a run may have used it. Deleting one is refused while a test or another
 * fixture still names it, as deleting a step group is.
 */

const router = asyncRouter();
// Every route is rate-limited before its role check; trying a fixture runs SQL, so it shares the heavy limit.
const fixturesLimit = sessionRateLimit();

const fixtureBodySchema = z.object({
  key: z
    .string()
    .regex(DATA_FIXTURE_KEY_PATTERN, 'A key is lowercase letters, digits, - and _ (at most 80)'),
  name: z.string().trim().min(1, 'A name is required').max(200),
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  definition: LibraryFixtureDefinitionSchema,
  /** What this version changes, in the author's words. */
  note: z.string().max(500).optional().nullable(),
});

/** The key names the fixture in its dependents' definitions, so it is never changed. */
const updateBodySchema = partialUpdate(fixtureBodySchema.omit({ key: true }));

const tryBodySchema = z.object({
  environmentId: z.number().int().positive(),
  mode: z.enum(['check', 'dry']),
  version: z.union([z.literal('latest'), z.number().int().positive()]).default('latest'),
  params: z.record(z.string(), z.string().max(2000)).default({}),
});

const idOf = (raw: string) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The tests and library fixtures that name this one: a delete would break them. */
export async function fixtureReferences(tx: TenantTx, fixture: LibraryFixture) {
  const contains = JSON.stringify([{ kind: 'ref', fixtureId: fixture.id }]);
  const working = await tx
    .select({ id: tests.id, name: tests.name })
    .from(tests)
    .where(sql`${tests.dataFixtures} @> ${contains}::jsonb`)
    .orderBy(asc(tests.name));
  // The published version is what plans run: it may still name the fixture after the working
  // copy stopped.
  const published = await tx
    .select({ id: tests.id, name: tests.name })
    .from(testVersions)
    .innerJoin(
      tests,
      and(eq(testVersions.testId, tests.id), eq(testVersions.version, tests.publishedVersion)),
    )
    .where(sql`${testVersions.dataFixtures} @> ${contains}::jsonb`);
  const byId = new Map<number, { id: number; name: string }>();
  for (const test of [...working, ...published]) byId.set(test.id, test);

  const needs = JSON.stringify({ dependsOn: [{ fixture: fixture.key }] });
  const dependents = await tx
    .select({
      id: dataFixtureLibrary.id,
      key: dataFixtureLibrary.key,
      name: dataFixtureLibrary.name,
    })
    .from(dataFixtureLibrary)
    .innerJoin(
      dataFixtureVersions,
      and(
        eq(dataFixtureVersions.fixtureId, dataFixtureLibrary.id),
        eq(dataFixtureVersions.version, dataFixtureLibrary.currentVersion),
      ),
    )
    .where(
      and(
        eq(dataFixtureLibrary.projectId, fixture.projectId),
        sql`${dataFixtureVersions.definition} @> ${needs}::jsonb`,
      ),
    )
    .orderBy(asc(dataFixtureLibrary.key));
  return { tests: [...byId.values()], fixtures: dependents };
}

async function loadFixture(tx: TenantTx, id: number) {
  const [row] = await tx
    .select()
    .from(dataFixtureLibrary)
    .where(eq(dataFixtureLibrary.id, id))
    .limit(1);
  return row ?? null;
}

// GET /api/projects/:projectId/data-fixtures — the library, each with its current definition,
// which is what a test adding one needs to show its parameters.
router.get(
  '/api/projects/:projectId/data-fixtures',
  fixturesLimit,
  requireRole('viewer'),
  async (req, res) => {
    const projectId = idOf(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id.' });
    // No organization predicate: RLS supplies it, so another tenant's project lists nothing.
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({ fixture: dataFixtureLibrary, definition: dataFixtureVersions.definition })
        .from(dataFixtureLibrary)
        .leftJoin(
          dataFixtureVersions,
          and(
            eq(dataFixtureVersions.fixtureId, dataFixtureLibrary.id),
            eq(dataFixtureVersions.version, dataFixtureLibrary.currentVersion),
          ),
        )
        .where(eq(dataFixtureLibrary.projectId, projectId))
        .orderBy(asc(dataFixtureLibrary.name)),
    );
    res.json(rows.map((row) => ({ ...row.fixture, definition: row.definition })));
  },
);

// GET /api/data-fixtures/:id — the fixture with every version, newest first.
router.get('/api/data-fixtures/:id', fixturesLimit, requireRole('viewer'), async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid fixture id.' });
  const found = await withTenantTransaction(async (tx) => {
    const fixture = await loadFixture(tx, id);
    if (!fixture) return null;
    const versions = await tx
      .select()
      .from(dataFixtureVersions)
      .where(eq(dataFixtureVersions.fixtureId, id))
      .orderBy(desc(dataFixtureVersions.version));
    return { ...fixture, versions };
  });
  if (!found) return res.status(404).json({ error: 'Data fixture not found.' });
  res.json(found);
});

// GET /api/data-fixtures/:id/references — the tests and fixtures that name it.
router.get(
  '/api/data-fixtures/:id/references',
  fixturesLimit,
  requireRole('viewer'),
  async (req, res) => {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid fixture id.' });
    const found = await withTenantTransaction(async (tx) => {
      const fixture = await loadFixture(tx, id);
      return fixture ? fixtureReferences(tx, fixture) : null;
    });
    if (!found) return res.status(404).json({ error: 'Data fixture not found.' });
    res.json(found);
  },
);

// POST /api/projects/:projectId/data-fixtures — a new fixture, as its version 1.
router.post(
  '/api/projects/:projectId/data-fixtures',
  fixturesLimit,
  requireRole('editor'),
  async (req, res) => {
    const projectId = idOf(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id.' });
    const parsed = fixtureBodySchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
    const body = parsed.data;

    try {
      const outcome = await withTenantTransaction(async (tx) => {
        // The project has to be one of ours, and RLS decides that: another tenant's id finds nothing.
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        if (!project) return { notFound: true as const };
        // Its dependencies must resolve before it is kept.
        await checkLibraryFixture(
          { id: 0, projectId, key: body.key, name: body.name, currentVersion: 1 },
          body.definition,
          libraryLoader(tx),
        );
        const [fixture] = await tx
          .insert(dataFixtureLibrary)
          .values({
            organizationId: req.user!.organizationId,
            projectId,
            key: body.key,
            name: body.name,
            description: body.description ?? null,
            tags: body.tags ?? [],
            currentVersion: 1,
            createdBy: req.user!.id,
          })
          .returning();
        await tx.insert(dataFixtureVersions).values({
          organizationId: req.user!.organizationId,
          fixtureId: fixture.id,
          version: 1,
          definition: body.definition,
          note: body.note ?? null,
          createdBy: req.user!.id,
        });
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.DATA_FIXTURE_CREATED,
          actor: auditActor(req),
          targetType: 'data_fixture',
          targetId: fixture.id,
          metadata: { key: fixture.key, name: fixture.name, projectId },
        });
        return { fixture };
      });
      if ('notFound' in outcome) return res.status(404).json({ error: 'Project not found.' });
      res.status(201).json(outcome.fixture);
    } catch (error) {
      if (error instanceof FixtureGraphError) return res.status(400).json({ error: error.message });
      if (isUniqueViolation(error))
        return res
          .status(409)
          .json({ error: `The project already has a fixture with the key "${body.key}".` });
      logger.error({ message: 'Failed to create a data fixture', error: errorText(error) });
      res.status(500).json({ error: 'Failed to create the data fixture.' });
    }
  },
);

// PUT /api/data-fixtures/:id — name, description and tags in place; a definition as a new version.
router.put('/api/data-fixtures/:id', fixturesLimit, requireRole('editor'), async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid fixture id.' });
  const parsed = updateBodySchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
  const body = parsed.data;

  try {
    const updated = await withTenantTransaction(async (tx) => {
      // FOR UPDATE: two saves at once must not both become the same next version.
      const [fixture] = await tx
        .select()
        .from(dataFixtureLibrary)
        .where(eq(dataFixtureLibrary.id, id))
        .for('update')
        .limit(1);
      if (!fixture) return null;
      let version = fixture.currentVersion;
      if (body.definition) {
        await checkLibraryFixture(fixture, body.definition, libraryLoader(tx));
        version += 1;
        await tx.insert(dataFixtureVersions).values({
          organizationId: fixture.organizationId,
          fixtureId: id,
          version,
          definition: body.definition,
          note: body.note ?? null,
          createdBy: req.user!.id,
        });
      }
      const [row] = await tx
        .update(dataFixtureLibrary)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          currentVersion: version,
          updatedAt: new Date(),
        })
        .where(eq(dataFixtureLibrary.id, id))
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.DATA_FIXTURE_UPDATED,
        actor: auditActor(req),
        targetType: 'data_fixture',
        targetId: id,
        metadata: {
          key: row.key,
          name: row.name,
          ...(body.definition ? { version } : {}),
        },
      });
      return row;
    });
    if (!updated) return res.status(404).json({ error: 'Data fixture not found.' });
    res.json(updated);
  } catch (error) {
    if (error instanceof FixtureGraphError) return res.status(400).json({ error: error.message });
    logger.error({ message: 'Failed to update a data fixture', error: errorText(error) });
    res.status(500).json({ error: 'Failed to update the data fixture.' });
  }
});

// DELETE /api/data-fixtures/:id — refused while a test or another fixture names it.
router.delete('/api/data-fixtures/:id', fixturesLimit, requireRole('editor'), async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid fixture id.' });
  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const fixture = await loadFixture(tx, id);
      if (!fixture) return null;
      const references = await fixtureReferences(tx, fixture);
      if (references.tests.length > 0 || references.fixtures.length > 0) return { references };
      await tx.delete(dataFixtureLibrary).where(eq(dataFixtureLibrary.id, id));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.DATA_FIXTURE_DELETED,
        actor: auditActor(req),
        targetType: 'data_fixture',
        targetId: id,
        metadata: { key: fixture.key, name: fixture.name, projectId: fixture.projectId },
      });
      return { deleted: true };
    });
    if (!outcome) return res.status(404).json({ error: 'Data fixture not found.' });
    if ('references' in outcome && outcome.references) {
      const { tests: using, fixtures: needing } = outcome.references;
      return res.status(409).json({
        error: `This fixture is still used by ${using.length} test(s) and ${needing.length} fixture(s).`,
        ...outcome.references,
      });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error({ message: 'Failed to delete a data fixture', error: errorText(error) });
    res.status(500).json({ error: 'Failed to delete the data fixture.' });
  }
});

/**
 * POST /api/data-fixtures/:id/try — the fixture and its dependencies against an environment's
 * database, from this server. `check` only reads; `dry` runs the scripts and rolls them back,
 * and needs an environment that allows data setup, as a real run would.
 */
router.post(
  '/api/data-fixtures/:id/try',
  sharedHeavyRateLimit(),
  requireRole('editor'),
  async (req, res) => {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid fixture id.' });
    const parsed = tryBodySchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Invalid data', details: flattenZodError(parsed.error) });
    const body = parsed.data;
    const { id: userId, organizationId } = req.user!;

    let nodes;
    try {
      nodes = await withTenantTransaction(async (tx) => {
        const fixture = await loadFixture(tx, id);
        if (!fixture) return null;
        const ref: DataFixtureRef = {
          kind: 'ref',
          id: 'try',
          alias: 'fixture',
          fixtureId: id,
          version: body.version,
          params: body.params,
        };
        return expandDataFixtures([ref], fixture.projectId, libraryLoader(tx));
      });
    } catch (error) {
      if (error instanceof FixtureGraphError) return res.status(400).json({ error: error.message });
      throw error;
    }
    if (!nodes) return res.status(404).json({ error: 'Data fixture not found.' });

    const vars = {
      ...(await resolveVariables({ userId, organizationId, environmentId: body.environmentId })),
      ...runVariables(`try-${uuidv4()}`),
    };
    const result = await runDataFixtures(nodes, vars, {
      dataSetup: await environmentAllowsDataSetup(organizationId, body.environmentId),
      mode: body.mode,
    });
    res.json(result);
  },
);

/**
 * GET /api/data-fixture-ledger — the fixtures runs applied and have a teardown for, with where
 * each stands. The default (`applying,pending,running,failed`) shows what is still to be removed;
 * `applying` is a fixture whose apply has not confirmed (in flight, or its worker died).
 */
router.get('/api/data-fixture-ledger', fixturesLimit, requireRole('editor'), async (req, res) => {
  const wanted = String(req.query.status ?? 'applying,pending,running,failed')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const status = wanted.filter((s): s is FixtureLedgerStatus =>
    (FIXTURE_LEDGER_STATUSES as readonly string[]).includes(s),
  );
  if (status.length !== wanted.length)
    return res
      .status(400)
      .json({ error: `status is one or more of ${FIXTURE_LEDGER_STATUSES.join(', ')}.` });
  const rows = await listLedger(req.user!.organizationId, { status });
  res.json(
    rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      testId: r.testId,
      environmentId: r.environmentId,
      name: r.name,
      alias: r.alias,
      policy: r.policy,
      status: r.status,
      attempts: r.attempts,
      detail: r.detail,
      appliedAt: r.appliedAt,
      settledAt: r.settledAt,
    })),
  );
});

/**
 * POST /api/data-fixture-ledger/:id/teardown — runs the teardown a crashed run left pending, on
 * the environment the data was applied to. 409 when another request has it or it is settled.
 */
router.post(
  '/api/data-fixture-ledger/:id/teardown',
  sharedHeavyRateLimit(),
  requireRole('editor'),
  async (req, res) => {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ledger id.' });
    const { id: userId, organizationId } = req.user!;
    const result = await retryLedgerRow(organizationId, id, {
      userId,
      actor: auditActor(req),
    });
    if (result.outcome === 'not-found')
      return res.status(404).json({ error: 'Ledger entry not found.' });
    if (result.outcome === 'not-claimable')
      return res.status(409).json({
        error: `This entry is ${result.status}: only a pending or failed one, or one stuck for over ten minutes, can be run.`,
      });
    res.status(result.outcome === 'done' ? 200 : 502).json(result);
  },
);

export default router;
