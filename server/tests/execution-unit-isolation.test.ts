import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq, inArray } from 'drizzle-orm';
import {
  executionUnitAttempts,
  executionUnits,
  healingProposals,
  organizations,
  projectMembers,
  projects,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
  tests,
  users,
  type Test,
} from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import { runArtifactAccess } from '../tenancy/artifact-access';
import { listRunUnits } from '../reporting/unit-evidence';
import {
  AttemptRefusedError,
  beginAttempt,
  planManifest,
  writeManifest,
} from '../execution/execution-units';
import type { FrozenTests } from '../execution/plan-run/definitions';
import type { BrowserChoice } from '../runtime/browsers';
import {
  approveHealingProposal,
  getHealingProposal,
  HealingProposalError,
  listHealingProposals,
} from '../authoring/healing-proposals';
import { createTestOrganization, createTestUser } from './factories';

/**
 * The tables the audit lots added (execution_units, execution_unit_attempts, healing_proposals),
 * under the policies a release must hold them to (P18).
 *
 * Runs in the normal suite on PGlite and, through `npm run test:rls:execution`, on a real
 * PostgreSQL as a non-superuser role: only the second certifies RLS and row locking. PGlite has one
 * connection, so the race between two workers for one unit runs on PostgreSQL alone.
 *
 * Cross-tenant: another organization sees none of a run's units, attempts or results and cannot
 * change them. Same tenant: a member who is not on a restricted project gets no unit, no link and
 * no healing proposal of that project's tests, even though the run itself is organization-wide.
 */

const onRealPostgres = !process.env.DATABASE_URL?.startsWith('memory://');
const chromium = { label: 'chromium', engine: 'chromium', headless: true } as BrowserChoice;

const orgIds: number[] = [];
let orgA: number;
let orgB: number;
let ownerA: number;
let outsiderA: number;
let viewerOnProject: number;
let userB: number;
let openTestId: number;
let closedTestId: number;
let closedProjectId: number;
let executionId: string;
let closedUnit: string;
let openUnit: string;
let proposalId: string;

const as = <T>(org: number, userId: number, role: string, fn: () => Promise<T>) =>
  runWithTenant(org, fn, { userId, role });

async function seedTest(org: number, user: number, projectId: number, name: string) {
  const [row] = await privilegedDb
    .insert(tests)
    .values({
      organizationId: org,
      userId: user,
      projectId,
      name,
      url: '',
      sequence: [],
      elements: [],
    })
    .returning();
  return row;
}

beforeAll(async () => {
  orgA = await createTestOrganization('Execution isolation A');
  orgB = await createTestOrganization('Execution isolation B');
  orgIds.push(orgA, orgB);
  ownerA = await createTestUser(orgA, `exec-owner-${uuidv4().slice(0, 6)}`);
  outsiderA = await createTestUser(orgA, `exec-outsider-${uuidv4().slice(0, 6)}`);
  viewerOnProject = await createTestUser(orgA, `exec-viewer-${uuidv4().slice(0, 6)}`);
  userB = await createTestUser(orgB, `exec-other-${uuidv4().slice(0, 6)}`);

  const [open] = await privilegedDb
    .insert(projects)
    .values({ name: 'Open app', userId: ownerA, organizationId: orgA })
    .returning();
  const [closed] = await privilegedDb
    .insert(projects)
    .values({ name: 'Customer app', userId: ownerA, organizationId: orgA, restricted: true })
    .returning();
  closedProjectId = closed.id;
  await privilegedDb.insert(projectMembers).values({
    projectId: closed.id,
    userId: viewerOnProject,
    organizationId: orgA,
    role: 'viewer',
  });
  openTestId = (await seedTest(orgA, ownerA, open.id, 'Open login')).id;
  closedTestId = (await seedTest(orgA, ownerA, closed.id, 'Customer login')).id;

  const planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Nightly', userId: ownerA, organizationId: orgA });
  executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId: orgA,
    testPlanId: planId,
    status: 'running',
    triggeredBy: 'manual',
  } as typeof testPlanExecutions.$inferInsert);

  const frozen: Pick<FrozenTests, 'links' | 'ui' | 'mobile'> = {
    links: [
      { testType: 'ui', testId: openTestId, apiTestId: null },
      { testType: 'ui', testId: closedTestId, apiTestId: null },
    ],
    ui: new Map(
      [openTestId, closedTestId].map((id) => [id, { id, name: `UI ${id}`, sequence: [] } as Test]),
    ),
    mobile: new Map(),
  };
  const manifest = planManifest(
    executionId,
    frozen,
    [{ requested: chromium, started: chromium }],
    null,
  );
  await runWithTenant(orgA, () => writeManifest(executionId, orgA, manifest.entries));
  [openUnit, closedUnit] = manifest.entries.map((entry) => entry.unitId);
  await runWithTenant(orgA, () => beginAttempt({ executionId, unitId: closedUnit }));
  await privilegedDb.insert(reportTestCaseResults).values([
    {
      id: uuidv4(),
      testPlanExecutionId: executionId,
      startedAt: new Date(),
      organizationId: orgA,
      uiTestId: openTestId,
      testType: 'ui',
      testName: 'Open login',
      status: 'passed',
      executionUnitId: openUnit,
    },
    {
      id: uuidv4(),
      testPlanExecutionId: executionId,
      startedAt: new Date(),
      organizationId: orgA,
      uiTestId: closedTestId,
      testType: 'ui',
      testName: 'Customer login',
      status: 'failed',
      executionUnitId: closedUnit,
      unitAttempt: 1,
    },
  ] as Array<typeof reportTestCaseResults.$inferInsert>);

  proposalId = `hp_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  await privilegedDb.insert(healingProposals).values({
    id: proposalId,
    organizationId: orgA,
    projectId: closedProjectId,
    testId: closedTestId,
    executionId,
    unitId: closedUnit,
    attempt: 1,
    stepIndex: 1,
    targetKind: 'test',
    targetRef: String(closedTestId),
    targetIndex: 0,
    sourceFingerprint: 'fp',
    origin: 'fallback',
    selectorBefore: '#old',
    selectorAfter: '#new',
  } as typeof healingProposals.$inferInsert);
});

afterAll(async () => {
  // Real-Postgres suites share one database: remove only this file's fixtures, in FK order.
  await privilegedDb
    .delete(healingProposals)
    .where(inArray(healingProposals.organizationId, orgIds));
  await privilegedDb
    .delete(testPlanExecutions)
    .where(inArray(testPlanExecutions.organizationId, orgIds));
  await privilegedDb.delete(testPlans).where(inArray(testPlans.organizationId, orgIds));
  await privilegedDb.delete(projectMembers).where(inArray(projectMembers.organizationId, orgIds));
  await privilegedDb.delete(tests).where(inArray(tests.organizationId, orgIds));
  await privilegedDb.delete(projects).where(inArray(projects.organizationId, orgIds));
  await privilegedDb.delete(users).where(inArray(users.organizationId, orgIds));
  await privilegedDb.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe('another organization', () => {
  it('sees none of the run’s units, attempts or results', async () => {
    const seen = await as(orgB, userB, 'owner', () =>
      withTenantTransaction(async (tx) => ({
        units: await tx
          .select()
          .from(executionUnits)
          .where(eq(executionUnits.executionId, executionId)),
        attempts: await tx
          .select()
          .from(executionUnitAttempts)
          .where(eq(executionUnitAttempts.executionId, executionId)),
        results: await tx
          .select()
          .from(reportTestCaseResults)
          .where(eq(reportTestCaseResults.testPlanExecutionId, executionId)),
      })),
    );
    expect(seen).toEqual({ units: [], attempts: [], results: [] });
    await expect(
      as(orgB, userB, 'owner', () => listRunUnits(executionId, { role: 'owner' })),
    ).resolves.toBeNull();
  });

  it('cannot change them, nor start an attempt at them', async () => {
    const changed = await as(orgB, userB, 'owner', () =>
      withTenantTransaction((tx) =>
        tx
          .update(executionUnits)
          .set({ state: 'recorded' })
          .where(eq(executionUnits.executionId, executionId))
          .returning(),
      ),
    );
    expect(changed).toEqual([]);
    await expect(
      runWithTenant(orgB, () => beginAttempt({ executionId, unitId: openUnit })),
    ).rejects.toBeInstanceOf(AttemptRefusedError);
    await expect(
      as(orgB, userB, 'owner', () =>
        withTenantTransaction((tx) =>
          tx.insert(executionUnitAttempts).values({
            executionId,
            organizationId: orgA,
            unitId: openUnit,
            attempt: 9,
            worker: 'foreign',
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it('sees no healing proposal of it', async () => {
    const listed = await as(orgB, userB, 'owner', () => listHealingProposals({ executionId }));
    expect(listed).toEqual([]);
  });
});

describe('a member who is not on the restricted project', () => {
  const outsider = <T>(fn: () => Promise<T>) => as(orgA, outsiderA, 'editor', fn);

  it('gets the open project’s unit and not the restricted one’s', async () => {
    const units = await outsider(() => listRunUnits(executionId, { role: 'editor' }));
    expect(units?.map((u) => u.unitId)).toEqual([openUnit]);
    const owner = await as(orgA, ownerA, 'owner', () =>
      listRunUnits(executionId, { role: 'owner' }),
    );
    expect(owner?.map((u) => u.unitId)).toEqual([openUnit, closedUnit]);
  });

  it('is handed no link to its evidence, in the new layout or the legacy one', async () => {
    const access = await outsider(() =>
      withTenantTransaction((tx) =>
        runArtifactAccess(tx, { organizationId: orgA, executionId, principal: { role: 'editor' } }),
      ),
    );
    for (const file of [
      `units/${closedUnit}/attempt_1/final.png`,
      `units/${closedUnit}/attempt_1/row_0/trace.zip`,
      `ui_${closedTestId}/final.png`,
    ]) {
      expect(access.decide(file)).toMatchObject({ allowed: false, reason: 'hidden' });
      expect(access.linkable(file)).toBe(false);
      // Hidden, not "restricted": the caller must not learn the file exists.
      expect(access.restricted(file)).toBe(false);
    }
    expect(access.linkable(`units/${openUnit}/attempt_1/final.png`)).toBe(true);
  });

  it('has the detail of a hidden test�s result withheld from the report (C-24)', async () => {
    const access = await outsider(() =>
      withTenantTransaction((tx) =>
        runArtifactAccess(tx, { organizationId: orgA, executionId, principal: null }),
      ),
    );
    expect(access.hiddenResult({ uiTestId: closedTestId })).toBe(true);
    expect(access.hiddenResult({ uiTestId: null, mobileTestId: null })).toBe(false);
  });

  it('cannot read, list or approve its healing proposals', async () => {
    await expect(outsider(() => listHealingProposals({ executionId }))).resolves.toEqual([]);
    await expect(outsider(() => getHealingProposal(proposalId))).resolves.toBeNull();
    await expect(
      outsider(() => approveHealingProposal(proposalId, 'fp', { id: outsiderA, username: 'x' })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a viewer on the project reads the proposal and cannot approve it', async () => {
    const viewer = <T>(fn: () => Promise<T>) => as(orgA, viewerOnProject, 'editor', fn);
    await expect(viewer(() => getHealingProposal(proposalId))).resolves.toMatchObject({
      id: proposalId,
    });
    const refused = await viewer(() =>
      approveHealingProposal(proposalId, 'fp', { id: viewerOnProject, username: 'v' }),
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HealingProposalError);
    expect(refused).toMatchObject({ status: 403, code: 'project_read_only' });
  });
});

describe.skipIf(!onRealPostgres)('two workers racing for one unit', () => {
  it('are numbered one after the other, never twice the same attempt', async () => {
    const race = await Promise.allSettled(
      [0, 1, 2].map(() =>
        runWithTenant(orgA, () => beginAttempt({ executionId, unitId: openUnit })),
      ),
    );
    const numbers = race
      .filter((r): r is PromiseFulfilledResult<{ attempt: number }> => r.status === 'fulfilled')
      .map((r) => r.value.attempt)
      .sort();
    expect(race.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(numbers).toEqual([1, 2, 3]);
  });
});

describe('the suite’s own fixtures', () => {
  it('seeded a manifest the organization reads back', async () => {
    const units = await runWithTenant(orgA, () =>
      withTenantTransaction((tx) =>
        tx.select().from(executionUnits).where(eq(executionUnits.executionId, executionId)),
      ),
    );
    expect(units.map((u) => u.unitId).sort()).toEqual([openUnit, closedUnit].sort());
  });
});
