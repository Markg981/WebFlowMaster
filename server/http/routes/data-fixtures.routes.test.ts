import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import {
  auditLog,
  dataFixtureLibrary,
  dataFixtureVersions,
  projects,
  tests as testsTable,
} from '@shared/schema';
import { createTestOrganization, createTestUser } from '../../tests/factories';

vi.mock('../../platform/logger', () => ({
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
 * The data fixture library: fixtures kept once per project, in versions, and not deleted while
 * a test or another fixture names them.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let projectId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const customer = (over: Record<string, unknown> = {}) => ({
  key: 'customer',
  name: 'A customer',
  definition: {
    params: [{ name: 'code', type: 'string', value: 'C-{{run.tag}}' }],
    check: 'SELECT id FROM customers WHERE code = {{params.code}}',
    apply: 'INSERT INTO customers (code) VALUES ({{params.code}})',
    outputs: ['id'],
  },
  ...over,
});

const order = {
  key: 'order',
  name: 'An order',
  definition: {
    dependsOn: [{ fixture: 'customer', as: 'customer', params: {} }],
    check: 'SELECT id FROM orders WHERE customer_id = {{fx.customer.id}}',
    apply: 'INSERT INTO orders (customer_id) VALUES ({{fx.customer.id}})',
    outputs: ['id'],
  },
};

beforeAll(async () => {
  organizationId = await createTestOrganization('Fixture Library Org');
  userId = await createTestUser(organizationId, 'fixture-library-user');
  otherOrganizationId = await createTestOrganization('Other Fixture Library Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-fixture-library-user');
  const [project] = await privilegedDb
    .insert(projects)
    .values({ name: 'Shop', userId, organizationId })
    .returning();
  projectId = project.id;

  const { default: routes } = await import('./data-fixtures.routes');
  const { default: testRoutes } = await import('./tests.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(routes);
  app.use(testRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testsTable).where(eq(testsTable.organizationId, organizationId));
  await privilegedDb
    .delete(dataFixtureLibrary)
    .where(eq(dataFixtureLibrary.organizationId, organizationId));
  currentUser = { id: userId, username: 'fixture-library-user', organizationId, role: 'editor' };
});

const create = (body: unknown) =>
  request(app).post(`/api/projects/${projectId}/data-fixtures`).send(body);

describe('the data fixture library', () => {
  it('keeps a fixture as its version 1, and lists it with its definition', async () => {
    const created = await create(customer());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'customer', currentVersion: 1, projectId });

    const list = await request(app).get(`/api/projects/${projectId}/data-fixtures`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].definition.params[0].name).toBe('code');

    const [audit] = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, String(created.body.id)));
    expect(audit?.action).toBe('data_fixture.created');
  });

  it('refuses a second fixture with the same key, and one whose dependency is not there', async () => {
    const orphan = await create(order);
    expect(orphan.status).toBe(400);
    expect(orphan.body.error).toMatch(/needs "customer"/);
    await create(customer());
    expect((await create(customer({ name: 'Again' }))).status).toBe(409);
  });

  it('saves a changed definition as a new version and keeps the old one', async () => {
    const { body: fixture } = await create(customer());
    const changed = await request(app)
      .put(`/api/data-fixtures/${fixture.id}`)
      .send({ definition: { ...customer().definition, outputs: [] }, note: 'no output' });
    expect(changed.body.currentVersion).toBe(2);
    const renamed = await request(app)
      .put(`/api/data-fixtures/${fixture.id}`)
      .send({ name: 'The customer' });
    expect(renamed.body).toMatchObject({ name: 'The customer', currentVersion: 2 });

    const detail = await request(app).get(`/api/data-fixtures/${fixture.id}`);
    expect(detail.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(detail.body.versions[0].note).toBe('no output');
  });

  it('refuses a new version that would make two fixtures need each other', async () => {
    const { body: first } = await create(customer());
    await create(order);
    const cycle = await request(app)
      .put(`/api/data-fixtures/${first.id}`)
      .send({
        definition: {
          ...customer().definition,
          dependsOn: [{ fixture: 'order', as: 'order', params: {} }],
        },
      });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error).toMatch(/needs itself: customer → order → customer/);
  });

  it('does not delete a fixture a test or another fixture still names', async () => {
    const { body: first } = await create(customer());
    const { body: second } = await create(order);
    await privilegedDb.insert(testsTable).values({
      userId,
      organizationId,
      projectId,
      name: 'Checkout',
      url: 'https://shop.test',
      sequence: [],
      elements: [],
      dataFixtures: [
        {
          kind: 'ref',
          id: 'r1',
          alias: 'order',
          fixtureId: second.id,
          version: 'latest',
          params: {},
        },
      ],
    });

    const refs = await request(app).get(`/api/data-fixtures/${first.id}/references`);
    expect(refs.body).toMatchObject({ tests: [], fixtures: [{ key: 'order' }] });
    const blocked = await request(app).delete(`/api/data-fixtures/${second.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.tests).toEqual([expect.objectContaining({ name: 'Checkout' })]);
    expect((await request(app).delete(`/api/data-fixtures/${first.id}`)).status).toBe(409);

    await privilegedDb.delete(testsTable).where(eq(testsTable.organizationId, organizationId));
    expect((await request(app).delete(`/api/data-fixtures/${second.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/data-fixtures/${first.id}`)).status).toBe(200);
    const versions = await privilegedDb
      .select()
      .from(dataFixtureVersions)
      .where(eq(dataFixtureVersions.fixtureId, first.id));
    expect(versions).toHaveLength(0);
  });

  it('shows another organization nothing, and lets a viewer only read', async () => {
    const { body: fixture } = await create(customer());
    currentUser = {
      id: otherUserId,
      username: 'other-fixture-library-user',
      organizationId: otherOrganizationId,
      role: 'editor',
    };
    expect((await request(app).get(`/api/data-fixtures/${fixture.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/projects/${projectId}/data-fixtures`)).body).toEqual([]);
    expect((await create(customer())).status).toBe(404);

    currentUser = { id: userId, username: 'fixture-library-user', organizationId, role: 'viewer' };
    expect((await request(app).get(`/api/data-fixtures/${fixture.id}`)).status).toBe(200);
    expect((await create(customer({ key: 'another' }))).status).toBe(403);
  });

  it('tries a fixture with its dependencies against an environment', async () => {
    await create(customer());
    const { body: second } = await create(order);
    const tried = await request(app)
      .post(`/api/data-fixtures/${second.id}/try`)
      .send({ environmentId: 999_999, mode: 'check' });
    expect(tried.status).toBe(200);
    // No environment with a db.url: the first node of the chain, the dependency, says so.
    expect(tried.body).toMatchObject({ ok: false, failedAt: 'A customer' });
    expect(tried.body.reason).toMatch(/db\.url/);
    expect(tried.body.steps[0].source).toBe('customer v1');
  });

  it('refuses to save a test whose reference does not resolve in its project', async () => {
    const { body: fixture } = await create(customer());
    const test = (dataFixtures: unknown[]) => ({
      name: `Uses the library ${dataFixtures.length}`,
      url: 'https://shop.test',
      projectId,
      sequence: [],
      elements: [],
      dataFixtures,
    });
    const ref = { kind: 'ref', id: 'r1', alias: 'customer', fixtureId: fixture.id };
    const unknown = await request(app)
      .post('/api/tests')
      .send(test([{ ...ref, params: { nope: 'x' } }]));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/has no parameter "nope"/);
    const saved = await request(app)
      .post('/api/tests')
      .send(test([ref, { ...ref, id: 'r2', alias: 'again' }]));
    expect(saved.status).toBe(201);
  });

  it('freezes references into plain fixtures at enqueue, and leaves a broken one to the run', async () => {
    await create(customer());
    const { body: second } = await create(order);
    const { freezeDataFixtures } = await import('../../authoring/fixture-graph');
    const { runWithTenant, withTenantTransaction } =
      await import('../../platform/middleware/tenancy');
    const freeze = (fixtures: unknown[]) =>
      runWithTenant(organizationId, () =>
        withTenantTransaction((tx) => freezeDataFixtures(tx, fixtures, projectId)),
      );
    const ref = {
      kind: 'ref',
      id: 'r1',
      alias: 'order',
      fixtureId: second.id,
      version: 'latest',
      params: {},
    };
    const frozen = (await freeze([ref])) as Array<{ alias: string; source: unknown }>;
    expect(frozen.map((f) => f.alias)).toEqual(['order__customer', 'order']);
    expect(frozen[1].source).toEqual({ fixtureId: second.id, key: 'order', version: 1 });
    const broken = [{ ...ref, version: 9 }];
    expect(await freeze(broken)).toBe(broken);
  });

  it('keeps a teardown and its policy through create, update, read and freeze', async () => {
    const withTeardown = customer({
      definition: {
        ...customer().definition,
        teardown: 'DELETE FROM customers WHERE code = {{params.code}}',
      },
    });
    const created = await create(withTeardown);
    expect(created.status).toBe(201);
    const list = await request(app).get(`/api/projects/${projectId}/data-fixtures`);
    expect(list.body[0].definition.teardown).toBe(
      'DELETE FROM customers WHERE code = {{params.code}}',
    );
    // A teardown that reads a parameter nobody declared is refused like an apply would be.
    const bad = await request(app)
      .put(`/api/data-fixtures/${created.body.id}`)
      .send({
        definition: {
          ...customer().definition,
          teardown: 'DELETE FROM t WHERE c = {{params.nope}}',
        },
      });
    expect(bad.status).toBe(400);

    const { body: second } = await create(order);
    const saved = await request(app)
      .post('/api/tests')
      .send({
        name: 'Teardown policy round trip',
        url: 'https://shop.test',
        projectId,
        sequence: [],
        elements: [],
        dataFixtures: [
          {
            kind: 'ref',
            id: 'r1',
            alias: 'order',
            fixtureId: second.id,
            version: 'latest',
            params: {},
            teardownPolicy: 'onSuccess',
          },
          {
            id: 'inline',
            name: 'Inline',
            alias: 'inline',
            params: [],
            check: 'SELECT 1 AS one',
            apply: 'SELECT 1',
            teardown: 'SELECT 2',
            teardownPolicy: 'never',
            outputs: [],
          },
        ],
      });
    expect(saved.status).toBe(201);
    const [stored] = await privilegedDb
      .select()
      .from(testsTable)
      .where(eq(testsTable.id, saved.body.id));
    const read = { body: stored as unknown as { dataFixtures: Array<Record<string, unknown>> } };
    expect(read.body.dataFixtures[0].teardownPolicy).toBe('onSuccess');
    expect(read.body.dataFixtures[1]).toMatchObject({
      teardown: 'SELECT 2',
      teardownPolicy: 'never',
    });

    const { freezeDataFixtures } = await import('../../authoring/fixture-graph');
    const { runWithTenant, withTenantTransaction } =
      await import('../../platform/middleware/tenancy');
    const frozen = (await runWithTenant(organizationId, () =>
      withTenantTransaction((tx) => freezeDataFixtures(tx, read.body.dataFixtures, projectId)),
    )) as Array<{ alias: string; teardownPolicy?: string }>;
    // The dependency the reference pulled in follows the policy of the entry that pulled it in.
    expect(frozen.map((f) => [f.alias, f.teardownPolicy])).toEqual([
      ['order__customer', 'onSuccess'],
      // This library order has no teardown, so it has no policy to carry.
      ['order', undefined],
      ['inline', 'never'],
    ]);
  });

  it('refuses an unknown teardown policy', async () => {
    const res = await request(app)
      .post('/api/tests')
      .send({
        name: 'Bad policy',
        url: 'https://shop.test',
        projectId,
        sequence: [],
        elements: [],
        dataFixtures: [
          {
            id: 'x',
            name: 'X',
            alias: 'x',
            params: [],
            check: 'SELECT 1 AS one',
            apply: 'SELECT 1',
            teardown: 'SELECT 2',
            teardownPolicy: 'sometimes',
            outputs: [],
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('lists the pending teardowns, refuses a stranger and an unknown row', async () => {
    const { fixtureLedger } = await import('@shared/schema');
    const [row] = await privilegedDb
      .insert(fixtureLedger)
      .values({
        organizationId,
        runId: 'run-ledger-route',
        alias: 'customer',
        name: 'A customer',
        policy: 'always',
        entry: {
          name: 'A customer',
          alias: 'customer',
          connection: null,
          timeoutMs: 1000,
          teardown: 'SELECT 1',
          params: [],
        },
        bindings: {},
        status: 'pending',
      })
      .returning();
    const list = await request(app).get('/api/data-fixture-ledger?status=pending,failed');
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(row.id);
    expect(JSON.stringify(list.body)).not.toMatch(/secret|db\./);

    expect((await request(app).post('/api/data-fixture-ledger/999999999/teardown')).status).toBe(
      404,
    );
    currentUser = {
      id: otherUserId,
      username: 'other',
      organizationId: otherOrganizationId,
      role: 'editor',
    };
    const stranger = await request(app).post(`/api/data-fixture-ledger/${row.id}/teardown`);
    expect(stranger.status).toBe(404);
    currentUser = { id: userId, username: 'fixture-library-user', organizationId, role: 'viewer' };
    expect((await request(app).post(`/api/data-fixture-ledger/${row.id}/teardown`)).status).toBe(
      403,
    );

    // An editor of the right organization: the environment is gone, so the teardown cannot run (502),
    // the row says why, and a second request finds it failed (retryable) rather than running twice.
    currentUser = { id: userId, username: 'fixture-library-user', organizationId, role: 'editor' };
    const failed = await request(app).post(`/api/data-fixture-ledger/${row.id}/teardown`);
    expect(failed.status).toBe(502);
    expect(failed.body.outcome).toBe('failed');
    expect(failed.body.detail).toMatch(/environment/);
    const [after] = await privilegedDb
      .select()
      .from(fixtureLedger)
      .where(eq(fixtureLedger.id, row.id));
    expect(after.status).toBe('failed');
    expect(after.attempts).toBe(1);

    // A settled or in-flight apply is refused with 409.
    await privilegedDb
      .update(fixtureLedger)
      .set({ status: 'done' })
      .where(eq(fixtureLedger.id, row.id));
    expect((await request(app).post(`/api/data-fixture-ledger/${row.id}/teardown`)).status).toBe(
      409,
    );
  });
});
