import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { projects, testVersions, tests as testsTable } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

vi.mock('../playwright-service', () => ({
  playwrightService: { executeAdhocSequence: vi.fn(), executeTestSequence: vi.fn() },
}));

/**
 * What a test used to be.
 *
 * Saving overwrote it and that was the whole history — and the builder turns a name collision
 * into an overwrite, so re-recording a flow discarded the previous walk through the application
 * with nothing left of it. These hold that every save is recoverable, that a save which changed
 * nothing does not manufacture a version, and that restoring adds to the history instead of
 * rewriting it.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let projectId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const step = (action: string, selector: string, value?: string) => ({
  id: `step-${Math.random().toString(36).slice(2)}`,
  action: { id: action, type: action, name: `a.${action}`, icon: 'x', description: 'd' },
  targetElement: { id: 'e1', type: 'button', selector, tag: 'button', attributes: {} },
  ...(value === undefined ? {} : { value }),
});

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Checkout',
  url: 'https://shop.test',
  projectId,
  sequence: [step('click', '#buy')],
  elements: [],
  ...overrides,
});

beforeAll(async () => {
  organizationId = await createTestOrganization('Versions Org');
  userId = await createTestUser(organizationId, 'versions-user');
  otherOrganizationId = await createTestOrganization('Other Versions Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-versions-user');

  const [project] = await privilegedDb.insert(projects).values({ name: 'Shop', userId, organizationId }).returning();
  projectId = project.id;

  const { default: testsRoutes } = await import('./tests.routes');
  const { default: versionRoutes } = await import('./test-versions.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(testsRoutes);
  app.use(versionRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testVersions);
  await privilegedDb.delete(testsTable);
  currentUser = { id: userId, username: 'versions-user', organizationId, role: 'editor' };
});

async function createTest(overrides: Record<string, unknown> = {}) {
  const response = await request(app).post('/api/tests').send(body(overrides)).expect(201);
  return response.body;
}

describe('a version per save', () => {
  it('records the test as created, so a history cannot begin at version 2', async () => {
    const created = await createTest();

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.versions).toHaveLength(1);
    expect(history.body.versions[0]).toMatchObject({
      version: 1,
      summary: 'Created with 1 step.',
      stepCount: 1,
      authorName: 'versions-user',
    });
  });

  it('records what a save changed', async () => {
    const created = await createTest();

    await request(app)
      .put(`/api/tests/${created.id}`)
      .send({ sequence: [step('click', '#buy'), step('assert', '#thanks')] })
      .expect(200);

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.versions.map((row: any) => row.version)).toEqual([2, 1]);
    expect(history.body.versions[0].summary).toBe('1 step added.');
  });

  it('does not manufacture a version for a save that saved nothing', async () => {
    // Otherwise a history fills with rows that differ in nothing, and the one real edit among
    // them is impossible to find.
    const created = await createTest();

    await request(app).put(`/api/tests/${created.id}`).send({ name: 'Checkout' }).expect(200);

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);
    expect(history.body.versions).toHaveLength(1);
  });

  it('keeps a version whose author has since been removed', async () => {
    const created = await createTest();
    // created_by is ON DELETE SET NULL: a member must be removable, and their work stays in
    // the history with an author nobody can name rather than disappearing with them.
    await privilegedDb.execute(sql`UPDATE test_versions SET created_by = NULL WHERE test_id = ${created.id}`);

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.versions).toHaveLength(1);
    expect(history.body.versions[0].authorName).toBeNull();
  });
});

/**
 * How each version actually did.
 *
 * A history that only says what changed is a list of edits. The question somebody opens it with
 * is which version was the one that worked, and every result records the version it ran — so
 * that is a count rather than a guess.
 */
describe('what each version did when it ran', () => {
  async function recordRun(testId: number, input: { status: string; testVersion: number | null }) {
    const executionId = `exec-${Math.random().toString(36).slice(2)}`;
    await privilegedDb.execute(
      sql`INSERT INTO test_plans (id, name, user_id, organization_id)
          VALUES ('plan-versions', 'Nightly', ${userId}, ${organizationId})
          ON CONFLICT (id) DO NOTHING`,
    );
    await privilegedDb.execute(
      sql`INSERT INTO test_plan_executions (id, test_plan_id, organization_id, status, started_at)
          VALUES (${executionId}, 'plan-versions', ${organizationId}, 'completed', ${new Date()})`,
    );
    await privilegedDb.execute(
      sql`INSERT INTO report_test_case_results
            (id, test_plan_execution_id, organization_id, ui_test_id, test_type, test_name, status, started_at, test_version)
          VALUES (${`rep-${Math.random().toString(36).slice(2)}`}, ${executionId}, ${organizationId}, ${testId},
                  'ui', 'Checkout', ${input.status}, ${new Date()}, ${input.testVersion})`,
    );
  }

  it('counts the runs of each version separately', async () => {
    const created = await createTest();
    await request(app).put(`/api/tests/${created.id}`).send({ sequence: [step('click', '#other')] }).expect(200);
    await recordRun(created.id, { status: 'Passed', testVersion: 1 });
    await recordRun(created.id, { status: 'Passed', testVersion: 1 });
    await recordRun(created.id, { status: 'Failed', testVersion: 2 });

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.versions[0]).toMatchObject({ version: 2, runs: 1, passed: 0, failed: 1 });
    expect(history.body.versions[1]).toMatchObject({ version: 1, runs: 2, passed: 2, failed: 0 });
  });

  it('says a version has never run rather than leaving it looking clean', async () => {
    const created = await createTest();

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.versions[0]).toMatchObject({ runs: 0, passed: 0, failed: 0, lastRunAt: null });
  });

  it('counts a run that never reached a verdict as neither', async () => {
    const created = await createTest();
    await recordRun(created.id, { status: 'Error', testVersion: 1 });

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.versions[0]).toMatchObject({ runs: 1, passed: 0, failed: 0 });
  });

  it('reports runs from before versions were recorded instead of attributing them', async () => {
    // Attributing them to whichever version happens to be first would be inventing history.
    const created = await createTest();
    await recordRun(created.id, { status: 'Passed', testVersion: null });
    await recordRun(created.id, { status: 'Failed', testVersion: null });
    await recordRun(created.id, { status: 'Passed', testVersion: 1 });

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);

    expect(history.body.unversionedRuns).toBe(2);
    expect(history.body.versions[0].runs).toBe(1);
  });
});

describe('reading one version', () => {
  it('answers with the whole snapshot, so it can be read before it is restored', async () => {
    const created = await createTest();
    await request(app).put(`/api/tests/${created.id}`).send({ sequence: [step('click', '#other')] }).expect(200);

    const version = await request(app).get(`/api/tests/${created.id}/versions/1`).expect(200);

    expect(version.body.sequence).toHaveLength(1);
    expect(version.body.sequence[0].targetElement.selector).toBe('#buy');
  });

  it('is a 404 for a version that does not exist', async () => {
    const created = await createTest();

    await request(app).get(`/api/tests/${created.id}/versions/99`).expect(404);
  });
});

describe('restoring', () => {
  it('puts the test back and says where it came from', async () => {
    const created = await createTest();
    await request(app)
      .put(`/api/tests/${created.id}`)
      .send({ name: 'Checkout v2', sequence: [step('click', '#other')] })
      .expect(200);

    const restored = await request(app).post(`/api/tests/${created.id}/versions/1/restore`).expect(200);

    expect(restored.body.test.name).toBe('Checkout');
    expect(restored.body.test.sequence[0].targetElement.selector).toBe('#buy');
    expect(restored.body.restoredFrom).toBe(1);
  });

  it('adds to the history instead of rewriting it', async () => {
    // The versions in between stay exactly where they are, and can be restored in turn. A
    // history the application can edit is not evidence of anything.
    const created = await createTest();
    await request(app).put(`/api/tests/${created.id}`).send({ sequence: [step('click', '#other')] }).expect(200);

    await request(app).post(`/api/tests/${created.id}/versions/1/restore`).expect(200);

    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);
    expect(history.body.versions.map((row: any) => row.version)).toEqual([3, 2, 1]);
    expect(history.body.versions[0].restoredFromVersion).toBe(1);
  });

  it('changes nothing, and records nothing, when the test already is that version', async () => {
    const created = await createTest();

    const restored = await request(app).post(`/api/tests/${created.id}/versions/1/restore`).expect(200);

    expect(restored.body.newVersion).toBeNull();
    const history = await request(app).get(`/api/tests/${created.id}/versions`).expect(200);
    expect(history.body.versions).toHaveLength(1);
  });

  it('leaves the fields a version does not hold alone', async () => {
    // A restore that silently moved the project, the author or the status would be doing more
    // than it said it was doing.
    const created = await createTest({ status: 'ready' });
    await request(app).put(`/api/tests/${created.id}`).send({ sequence: [step('click', '#other')] }).expect(200);

    await request(app).post(`/api/tests/${created.id}/versions/1/restore`).expect(200);

    const [row] = await privilegedDb.select().from(testsTable);
    expect(row.status).toBe('ready');
    expect(row.projectId).toBe(projectId);
    expect(row.userId).toBe(userId);
  });

  it('is closed to a viewer, who may still read the history', async () => {
    const created = await createTest();
    currentUser = { id: userId, username: 'versions-user', organizationId, role: 'viewer' };

    await request(app).get(`/api/tests/${created.id}/versions`).expect(200);
    await request(app).post(`/api/tests/${created.id}/versions/1/restore`).expect(403);
  });
});

describe('another organization', () => {
  it('has no history here, and cannot restore one', async () => {
    const created = await createTest();
    currentUser = { id: otherUserId, username: 'other-versions-user', organizationId: otherOrganizationId, role: 'owner' };

    await request(app).get(`/api/tests/${created.id}/versions`).expect(404);
    await request(app).post(`/api/tests/${created.id}/versions/1/restore`).expect(404);
  });
});

describe('the history cannot be rewritten', () => {
  it('refuses a delete from the application, whatever the application asks', async () => {
    // app_user is granted SELECT and INSERT on test_versions and nothing else (migration 0018),
    // so this is not a rule the code remembers to follow — it is one it cannot break.
    const created = await createTest();
    const { withTenantTransaction } = await import('../middleware/tenancy');
    const { runWithTenant } = await import('../middleware/tenancy');

    await expect(
      runWithTenant(organizationId, () =>
        withTenantTransaction((tx) => tx.execute(sql`DELETE FROM test_versions WHERE test_id = ${created.id}`)),
      ),
    ).rejects.toThrow();
  });
});
