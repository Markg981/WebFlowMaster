import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';

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
vi.mock('../../platform/queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: { add: vi.fn() },
}));
// The scheduler's jobs are its own; what matters here is that it is told, after the transaction.
const scheduler = {
  addScheduleJob: vi.fn(),
  updateScheduleJob: vi.fn(),
  removeScheduleJob: vi.fn(),
};
vi.mock('../../execution/scheduler-service', async (importActual) => ({
  ...(await importActual<typeof import('../../execution/scheduler-service')>()),
  default: scheduler,
}));
const { privilegedDb } = await import('../../platform/db');
const { apiKeys, users, auditLog, secrets, testPlanExecutions, testTags } =
  await import('@shared/schema');
const { createTestOrganization, createTestUser } = await import('../../tests/factories');
const { generateApiKey } = await import('../../identity/api-keys');
const { apiKeyAuth } = await import('../middleware/api-key-auth');
const { tenancyMiddleware } = await import('../../platform/middleware/tenancy');
const { registerAuthoringRoutes } = await import('./authoring');
const { registerManagementRoutes } = await import('./management');
const { setArtifactStoreForTest } = await import('../../tenancy/artifact-store');
type ArtifactStore = import('../../tenancy/artifact-store').ArtifactStore;
const { API_SCOPE_NAMES } = await import('@shared/api-scopes');

let app: express.Express,
  org: number,
  user: number,
  key: string,
  otherKey: string,
  viewerKey: string;
const auth = (value = key) => ({ Authorization: `Bearer ${value}` });
async function makeKey(userId: number, organizationId: number, scopes: string[]) {
  const generated = generateApiKey();
  await privilegedDb.insert(apiKeys).values({
    id: randomUUID(),
    organizationId,
    userId,
    name: 'Management fixture',
    prefix: generated.prefix,
    hashedKey: generated.hashedKey,
    scopes,
  });
  return generated.key;
}
async function createPlan(name: string, as = key) {
  const plan = await request(app).post('/api/v1/plans').set(auth(as)).send({ name }).expect(201);
  return plan.body.id as string;
}
async function createUiTest(name: string) {
  const test = await request(app)
    .post('/api/v1/tests')
    .set(auth())
    .send({ name, url: 'https://example.test', sequence: [], elements: [] })
    .expect(201);
  return test.body.id as number;
}

beforeAll(async () => {
  org = await createTestOrganization(`management-${randomUUID()}`);
  user = await createTestUser(org);
  key = await makeKey(user, org, API_SCOPE_NAMES);
  const other = await createTestOrganization(`other-${randomUUID()}`);
  otherKey = await makeKey(await createTestUser(other), other, API_SCOPE_NAMES);
  const viewer = await createTestUser(org);
  await privilegedDb.update(users).set({ role: 'viewer' }).where(eq(users.id, viewer));
  viewerKey = await makeKey(viewer, org, API_SCOPE_NAMES);
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => false) as typeof req.isAuthenticated;
    next();
  });
  app.use(apiKeyAuth);
  app.use(tenancyMiddleware);
  const router = express.Router();
  registerAuthoringRoutes(router);
  registerManagementRoutes(router);
  app.use(router);
});
afterAll(() => setArtifactStoreForTest(undefined));

describe('schedules through /api/v1', () => {
  it('creates, reads, changes, pauses, resumes and deletes a schedule, telling the scheduler', async () => {
    const planId = await createPlan(`Scheduled ${randomUUID()}`);
    const input = {
      testPlanId: planId,
      scheduleName: 'Nightly',
      frequency: 'cron:0 2 * * *',
      nextRunAt: '2030-01-01T00:00:00Z',
      timezone: 'Europe/Rome',
      browsers: ['chromium'],
      executionParameters: { headless: true },
    };
    await request(app)
      .post('/api/v1/schedules')
      .set(auth())
      .send({ ...input, timezone: 'Mars/Olympus' })
      .expect(400);
    await request(app)
      .post('/api/v1/schedules')
      .set(auth())
      .send({ ...input, frequency: 'cron:not a cron' })
      .expect(400);
    await request(app)
      .post('/api/v1/schedules')
      .set(auth())
      .send({ ...input, organizationId: org })
      .expect(400);
    await request(app)
      .post('/api/v1/schedules')
      .set(auth(otherKey))
      .send(input)
      .expect(404)
      .expect((res) => expect(res.body.error.code).toBe('plan_not_found'));
    await request(app).post('/api/v1/schedules').set(auth(viewerKey)).send(input).expect(403);

    const created = await request(app)
      .post('/api/v1/schedules')
      .set(auth())
      .send(input)
      .expect(201);
    expect(created.body).toMatchObject({
      testPlanId: planId,
      testPlanName: expect.stringContaining('Scheduled'),
      scheduleName: 'Nightly',
      frequency: 'cron:0 2 * * *',
      timezone: 'Europe/Rome',
      browsers: ['chromium'],
      executionParameters: { headless: true },
      isActive: true,
      retryOnFailure: 'none',
    });
    expect(created.body).not.toHaveProperty('organizationId');
    expect(created.body).not.toHaveProperty('userId');
    // The pattern's first occurrence in its zone: 02:00 in Rome is 01:00 UTC.
    expect(created.body.nextRunAt).toBe('2030-01-01T01:00:00.000Z');
    expect(scheduler.addScheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.body.id, isActive: true }),
    );

    const path = `/api/v1/schedules/${created.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    await request(app)
      .get(`/api/v1/schedules?testPlanId=${planId}`)
      .set(auth())
      .expect(200)
      .expect((res) =>
        expect(res.body.items.map((row: { id: string }) => row.id)).toEqual([created.body.id]),
      );

    const changed = await request(app)
      .patch(path)
      .set(auth())
      .send({ scheduleName: 'Nightly, later', frequency: 'cron:0 3 * * *' })
      .expect(200);
    expect(changed.body).toMatchObject({
      scheduleName: 'Nightly, later',
      nextRunAt: '2030-01-01T02:00:00.000Z',
    });
    expect(scheduler.updateScheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.body.id, scheduleName: 'Nightly, later' }),
    );
    await request(app).patch(path).set(auth()).send({}).expect(400);
    await request(app).patch(path).set(auth()).send({ testPlanId: 'no-such-plan' }).expect(404);

    const paused = await request(app).post(`${path}/pause`).set(auth()).expect(200);
    expect(paused.body.isActive).toBe(false);
    expect(scheduler.updateScheduleJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: created.body.id, isActive: false }),
    );
    const resumed = await request(app).post(`${path}/resume`).set(auth()).expect(200);
    expect(resumed.body.isActive).toBe(true);
    await request(app).post(`${path}/pause`).set(auth(otherKey)).expect(404);

    await request(app).delete(path).set(auth(otherKey)).expect(404);
    await request(app).delete(path).set(auth()).expect(204);
    expect(scheduler.removeScheduleJob).toHaveBeenCalledWith(created.body.id);
    await request(app).get(path).set(auth()).expect(404);

    const audits = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, created.body.id));
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(['schedule.created', 'schedule.updated', 'schedule.deleted']),
    );
    expect(audits.filter((row) => row.action === 'schedule.updated')).toHaveLength(3);
  });
  it('needs the schedules scopes, not the plan ones', async () => {
    const planKey = await makeKey(user, org, ['plans:read', 'plans:write']);
    const denied = await request(app).get('/api/v1/schedules').set(auth(planKey)).expect(403);
    expect(denied.body.error).toMatchObject({
      code: 'insufficient_scope',
      requiredScope: 'schedules:read',
    });
  });
});

describe('environments and secrets through /api/v1', () => {
  it('manages environments and keeps secret values write-only', async () => {
    const name = `Staging ${randomUUID().slice(0, 8)}`;
    const created = await request(app)
      .post('/api/v1/environments')
      .set(auth())
      .send({ name, description: 'For the pipeline' })
      .expect(201);
    expect(created.body).toEqual({
      id: expect.any(Number),
      name,
      description: 'For the pipeline',
      createdAt: expect.any(String),
      loginStateCapturedAt: null,
    });
    await request(app)
      .post('/api/v1/environments')
      .set(auth())
      .send({ name: name.toUpperCase() })
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('name_conflict'));
    // The same name in another organization is another environment.
    await request(app).post('/api/v1/environments').set(auth(otherKey)).send({ name }).expect(201);
    const path = `/api/v1/environments/${created.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    await request(app)
      .get('/api/v1/environments?limit=100')
      .set(auth())
      .expect(200)
      .expect((res) =>
        expect(res.body.items.some((row: { id: number }) => row.id === created.body.id)).toBe(true),
      );

    const secretPath = `${path}/secrets/api.token`;
    const envKey = await makeKey(user, org, ['environments:read', 'environments:write']);
    const denied = await request(app)
      .put(secretPath)
      .set(auth(envKey))
      .send({ value: 'hunter2' })
      .expect(403);
    expect(denied.body.error.requiredScope).toBe('secrets:write');
    await request(app)
      .put(`${path}/secrets/no spaces`)
      .set(auth())
      .send({ value: 'x' })
      .expect(400);
    await request(app).put(secretPath).set(auth()).send({ value: '' }).expect(400);
    await request(app).put(secretPath).set(auth(otherKey)).send({ value: 'x' }).expect(404);

    const set = await request(app)
      .put(secretPath)
      .set(auth())
      .send({ value: 'hunter2' })
      .expect(201);
    expect(set.body).toEqual({
      id: expect.any(Number),
      environmentId: created.body.id,
      keyName: 'api.token',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const rotated = await request(app)
      .put(secretPath)
      .set(auth())
      .send({ value: 'hunter3' })
      .expect(200);
    expect(rotated.body.id).not.toBe(set.body.id);
    const stored = await privilegedDb
      .select()
      .from(secrets)
      .where(eq(secrets.environmentId, created.body.id));
    expect(stored).toHaveLength(1);
    expect(stored[0].encryptedValue).not.toContain('hunter');
    const listed = await request(app).get(`${path}/secrets`).set(auth(envKey)).expect(200);
    expect(listed.body.items).toEqual([expect.objectContaining({ keyName: 'api.token' })]);
    expect(JSON.stringify(listed.body)).not.toMatch(/hunter|encryptedValue|iv|authTag/);
    const audits = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetType, 'secret'));
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(['secret.set']));
    expect(JSON.stringify(audits.map((row) => row.metadata))).not.toContain('hunter');

    await request(app).delete(secretPath).set(auth()).expect(204);
    await request(app).delete(secretPath).set(auth()).expect(404);
    await request(app).put(secretPath).set(auth()).send({ value: 'hunter4' }).expect(201);
    await request(app).delete(path).set(auth(otherKey)).expect(404);
    await request(app).delete(path).set(auth()).expect(204);
    expect(
      (await privilegedDb.select().from(secrets).where(eq(secrets.environmentId, created.body.id)))
        .length,
    ).toBe(0);
    await request(app).get(path).set(auth()).expect(404);
  });
});

describe('run evidence through /api/v1', () => {
  it('lists what a run left behind with streamable links, inside its own directory', async () => {
    const planId = await createPlan(`Evidence ${randomUUID()}`);
    const runId = randomUUID();
    await privilegedDb
      .insert(testPlanExecutions)
      .values({ id: runId, organizationId: org, testPlanId: planId, status: 'completed' });
    const files: Record<string, string> = {
      [`results/${planId}/${runId}/chromium/step_001.png`]: 'png bytes',
      [`results/${planId}/${runId}/chromium/lighthouse.html`]: '<html>report</html>',
      [`results/${planId}/${runId}/run.log`]: 'log line',
    };
    const store: ArtifactStore = {
      kind: 'local',
      read: async () => null,
      write: async () => {},
      publishDirectory: async () => 0,
      deletePrefix: async () => 0,
      list: async (prefix) =>
        Object.entries(files)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, body]) => ({ key, size: body.length })),
      open: async (key) =>
        files[key]
          ? {
              stream: Readable.from([Buffer.from(files[key])]),
              contentType: key.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png',
              size: files[key].length,
            }
          : null,
    };
    setArtifactStoreForTest(store);

    await request(app).get(`/api/v1/runs/${runId}/evidence`).set(auth(otherKey)).expect(404);
    const listed = await request(app).get(`/api/v1/runs/${runId}/evidence`).set(auth()).expect(200);
    expect(listed.body).toMatchObject({ limit: 20, offset: 0, total: 3, purged: false });
    expect(listed.body.items).toEqual([
      {
        path: 'chromium/lighthouse.html',
        kind: 'report',
        contentType: 'text/html; charset=utf-8',
        size: 19,
        url: `/api/v1/runs/${runId}/artifacts/chromium/lighthouse.html`,
      },
      expect.objectContaining({ path: 'chromium/step_001.png', kind: 'screenshot' }),
      expect.objectContaining({
        path: 'run.log',
        kind: 'log',
        contentType: 'application/octet-stream',
      }),
    ]);
    const paged = await request(app)
      .get(`/api/v1/runs/${runId}/evidence?limit=1&offset=1`)
      .set(auth())
      .expect(200);
    expect(paged.body.items.map((item: { path: string }) => item.path)).toEqual([
      'chromium/step_001.png',
    ]);

    const image = await request(app).get(listed.body.items[1].url).set(auth()).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.body.toString()).toBe('png bytes');
    const report = await request(app).get(listed.body.items[0].url).set(auth()).expect(200);
    expect(report.headers['content-security-policy']).toContain('sandbox');
    await request(app).get(listed.body.items[1].url).set(auth(otherKey)).expect(404);
    await request(app).get(listed.body.items[1].url).set(auth(viewerKey)).expect(200);
    await request(app)
      .get(`/api/v1/runs/${runId}/artifacts/chromium/missing.png`)
      .set(auth())
      .expect(404)
      .expect((res) => expect(res.body.error.code).toBe('artifact_not_found'));
    await request(app)
      .get(`/api/v1/runs/${runId}/artifacts/..%2F..%2F.env`)
      .set(auth())
      .expect(400)
      .expect((res) => expect(res.body.error.code).toBe('invalid_request'));

    await privilegedDb
      .update(testPlanExecutions)
      .set({ artifactsPurgedAt: new Date() })
      .where(eq(testPlanExecutions.id, runId));
    const purged = await request(app).get(`/api/v1/runs/${runId}/evidence`).set(auth()).expect(200);
    expect(purged.body).toMatchObject({ items: [], total: 0, purged: true });
  });
});

describe('raw run evidence through /api/v1: role and scope (P03)', () => {
  it('lists and serves traces and HAR files only to an editor whose key holds runs:evidence', async () => {
    const SENTINEL = 'Sentinel-Trace-Pw-v1-77ab';
    const planId = await createPlan(`Raw evidence ${randomUUID()}`);
    const runId = randomUUID();
    await privilegedDb
      .insert(testPlanExecutions)
      .values({ id: runId, organizationId: org, testPlanId: planId, status: 'completed' });
    const files: Record<string, string> = {
      [`results/${planId}/${runId}/ui_1/step_001.png`]: 'png bytes',
      [`results/${planId}/${runId}/ui_1/login_trace.zip`]: `password=${SENTINEL}`,
      [`results/${planId}/${runId}/ui_1/login_network.har`]: `{"password":"${SENTINEL}"}`,
    };
    setArtifactStoreForTest({
      kind: 'local',
      read: async () => null,
      write: async () => {},
      publishDirectory: async () => 0,
      deletePrefix: async () => 0,
      list: async (prefix) =>
        Object.entries(files)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, body]) => ({ key: k, size: body.length })),
      open: async (k) =>
        files[k]
          ? {
              stream: Readable.from([Buffer.from(files[k])]),
              contentType: 'application/octet-stream',
              size: files[k].length,
            }
          : null,
    });
    const trace = `/api/v1/runs/${runId}/artifacts/ui_1/login_trace.zip`;
    const har = `/api/v1/runs/${runId}/artifacts/ui_1/login_network.har`;
    const paths = (body: { items: Array<{ path: string }> }) => body.items.map((i) => i.path);

    // A viewer's key, with every scope: the role is the ceiling.
    const asViewer = await request(app)
      .get(`/api/v1/runs/${runId}/evidence`)
      .set(auth(viewerKey))
      .expect(200);
    expect(paths(asViewer.body)).toEqual(['ui_1/step_001.png']);
    expect(asViewer.body.withheld).toBe(2);
    expect(JSON.stringify(asViewer.body)).not.toContain('login_trace.zip');
    for (const url of [trace, har]) {
      const refused = await request(app).get(url).set(auth(viewerKey)).expect(403);
      expect(refused.body.error.code).toBe('insufficient_role');
      expect(JSON.stringify(refused.body)).not.toContain(SENTINEL);
    }

    // An editor's key that may read runs but was not given runs:evidence.
    const readOnly = await makeKey(user, org, ['runs:read']);
    const listed = await request(app)
      .get(`/api/v1/runs/${runId}/evidence`)
      .set(auth(readOnly))
      .expect(200);
    expect(paths(listed.body)).toEqual(['ui_1/step_001.png']);
    const scoped = await request(app).get(trace).set(auth(readOnly)).expect(403);
    expect(scoped.body.error).toMatchObject({
      code: 'insufficient_scope',
      requiredScope: 'runs:evidence',
    });

    // The same editor with runs:evidence; a key from before scopes is no credential (audit C-03).
    const evidence = await makeKey(user, org, ['runs:read', 'runs:evidence']);
    const generated = generateApiKey();
    await privilegedDb.insert(apiKeys).values({
      id: randomUUID(),
      organizationId: org,
      userId: user,
      name: 'Unscoped fixture',
      prefix: generated.prefix,
      hashedKey: generated.hashedKey,
      scopes: null,
    } as any);
    await request(app).get(trace).set(auth(generated.key)).expect(401);
    for (const allowed of [evidence]) {
      const all = await request(app)
        .get(`/api/v1/runs/${runId}/evidence`)
        .set(auth(allowed))
        .expect(200);
      expect(paths(all.body)).toEqual([
        'ui_1/login_network.har',
        'ui_1/login_trace.zip',
        'ui_1/step_001.png',
      ]);
      expect(all.body.withheld).toBe(0);
      const served = await request(app)
        .get(trace)
        .set(auth(allowed))
        .responseType('blob')
        .expect(200);
      expect(Buffer.from(served.body).toString()).toContain(SENTINEL);
    }

    // Another organization's key, with every scope: the run is not there.
    await request(app).get(trace).set(auth(otherKey)).expect(404);
  });
});

describe("a run's units, attempts and rows through /api/v1 (P08)", () => {
  it('lists the units and opens one unit’s attempts, with links only to what the key may open', async () => {
    const { executionUnits, executionUnitAttempts, reportTestCaseResults } =
      await import('@shared/schema');
    const planId = await createPlan(`Units ${randomUUID()}`);
    const runId = randomUUID();
    await privilegedDb
      .insert(testPlanExecutions)
      .values({ id: runId, organizationId: org, testPlanId: planId, status: 'completed' });
    const testId = await createUiTest(`Units-${randomUUID()}`);
    const unitIds = ['u_' + 'a'.repeat(24), 'u_' + 'b'.repeat(24)];
    for (const [position, unitId] of unitIds.entries()) {
      await privilegedDb.insert(executionUnits).values({
        executionId: runId,
        organizationId: org,
        unitId,
        position,
        coordinates: {
          testType: 'ui',
          testId,
          occurrence: 0,
          browser: {
            name: 'chromium',
            channel: null,
            device: null,
            os: null,
            osVersion: null,
            browserVersion: null,
          },
          locale: position === 0 ? 'en-US' : 'it-IT',
          device: null,
          bddRow: null,
        },
        state: 'recorded',
      });
      await privilegedDb.insert(executionUnitAttempts).values({
        executionId: runId,
        organizationId: org,
        unitId,
        attempt: 1,
        state: 'finished',
        status: 'failed',
        failureReason: 'Row 2 of 2: no button',
        worker: 'worker-host:42',
        evidence: {
          traceUrl: null,
          rows: [0, 1].map((row) => ({
            datasetRow: row,
            status: row === 1 ? ('failed' as const) : ('passed' as const),
            screenshotUrl: `/results/${planId}/${runId}/units/${unitId}/attempt_1/row_${row}/step.png`,
            traceUrl: `/results/${planId}/${runId}/units/${unitId}/attempt_1/row_${row}/t_trace.zip`,
          })),
        },
      });
      await privilegedDb.insert(reportTestCaseResults).values({
        id: randomUUID(),
        organizationId: org,
        testPlanExecutionId: runId,
        uiTestId: testId,
        testName: 'Checkout',
        testType: 'ui',
        status: 'Failed',
        startedAt: new Date(),
        executionUnitId: unitId,
        unitAttempt: 1,
      } as any);
    }

    const listed = await request(app).get(`/api/v1/runs/${runId}/units`).set(auth()).expect(200);
    expect(listed.body).toMatchObject({ total: 2, offset: 0 });
    expect(listed.body.items.map((u: { locale: string }) => u.locale)).toEqual(['en-US', 'it-IT']);
    expect(listed.body.items[0]).toMatchObject({
      unitId: unitIds[0],
      browser: 'chromium',
      result: { status: 'Failed', attempts: 1, decidingAttempt: 1 },
    });
    const paged = await request(app)
      .get(`/api/v1/runs/${runId}/units?limit=1&offset=1`)
      .set(auth())
      .expect(200);
    expect(paged.body.items.map((u: { unitId: string }) => u.unitId)).toEqual([unitIds[1]]);

    const detailPath = `/api/v1/runs/${runId}/units/${unitIds[1]}`;
    const evidenceKey = await makeKey(user, org, ['runs:read', 'runs:evidence']);
    const full = await request(app).get(detailPath).set(auth(evidenceKey)).expect(200);
    const rows = full.body.evidence.attempts[0].rows;
    expect(rows.map((r: { datasetRow: number }) => r.datasetRow)).toEqual([0, 1]);
    expect(rows[1].traceUrl).toBe(
      `/api/v1/runs/${runId}/artifacts/units/${unitIds[1]}/attempt_1/row_1/t_trace.zip`,
    );
    // Not the database row: no worker, no stored path.
    expect(JSON.stringify(full.body)).not.toContain('worker-host');
    expect(JSON.stringify(full.body)).not.toContain('/results/');

    // A key without runs:evidence, and a viewer: the screenshot, not the trace.
    for (const limited of [await makeKey(user, org, ['runs:read']), viewerKey]) {
      const seen = await request(app).get(detailPath).set(auth(limited)).expect(200);
      const row = seen.body.evidence.attempts[0].rows[1];
      expect(row).toMatchObject({ traceUrl: null, restricted: true });
      expect(row.screenshotUrl).toContain('/row_1/step.png');
    }

    await request(app).get(detailPath).set(auth(otherKey)).expect(404);
    await request(app).get(`/api/v1/runs/${runId}/units`).set(auth(otherKey)).expect(404);
    await request(app)
      .get(`/api/v1/runs/${runId}/units/u_${'c'.repeat(24)}`)
      .set(auth())
      .expect(404);
  });
});

describe('tags through /api/v1', () => {
  it('creates once per name, renames, counts and deletes with how many tests carried it', async () => {
    const name = `smoke ${randomUUID().slice(0, 8)}`;
    const created = await request(app).post('/api/v1/tags').set(auth()).send({ name }).expect(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name,
      createdAt: expect.any(String),
      uiCount: 0,
      apiCount: 0,
      mobileCount: 0,
    });
    const again = await request(app)
      .post('/api/v1/tags')
      .set(auth())
      .send({ name: `  ${name.toUpperCase()}  ` })
      .expect(200);
    expect(again.body.id).toBe(created.body.id);
    const path = `/api/v1/tags/${created.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    await request(app).post('/api/v1/tags').set(auth(viewerKey)).send({ name: 'x' }).expect(403);

    const testId = await createUiTest(`Tagged-${randomUUID()}`);
    await privilegedDb
      .insert(testTags)
      .values({ organizationId: org, tagId: created.body.id, testId, testType: 'ui' });
    const other = await request(app)
      .post('/api/v1/tags')
      .set(auth())
      .send({ name: `${name} other` })
      .expect(201);
    await request(app)
      .patch(path)
      .set(auth())
      .send({ name: `${name} OTHER` })
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('name_conflict'));
    const renamed = await request(app)
      .patch(path)
      .set(auth())
      .send({ name: `${name} renamed` })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: `${name} renamed`, uiCount: 1, apiCount: 0 });
    const listed = await request(app).get('/api/v1/tags?limit=100').set(auth()).expect(200);
    expect(listed.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.body.id, uiCount: 1 })]),
    );
    await request(app).delete(path).set(auth(otherKey)).expect(404);
    const deleted = await request(app).delete(path).set(auth()).expect(200);
    expect(deleted.body).toEqual({ id: created.body.id, removedFrom: 1 });
    await request(app).get(path).set(auth()).expect(404);
    await request(app).delete(`/api/v1/tags/${other.body.id}`).set(auth()).expect(200);
  });
});

describe('billing through /api/v1', () => {
  it('reads the plan, the status and the limits in force with billing:read, and nothing less', async () => {
    const result = await request(app).get('/api/v1/billing').set(auth()).expect(200);
    expect(result.body).toMatchObject({
      provider: 'none',
      plan: { code: 'free' },
      subscription: { organizationId: org, status: 'active' },
      entitlement: { runsBlocked: false },
      quotas: { mode: 'enforce' },
      usage: { running: 0, queued: 0 },
    });
    const narrow = await makeKey(user, org, ['runs:read']);
    await request(app)
      .get('/api/v1/billing')
      .set(auth(narrow))
      .expect(403)
      .expect((res) => expect(res.body.error.code).toBe('insufficient_scope'));
    // A viewer may read it: the banner is everybody's.
    await request(app).get('/api/v1/billing').set(auth(viewerKey)).expect(200);
  });
});

describe('quarantine through /api/v1', () => {
  it('sets a test aside once, lists it, and brings it back once', async () => {
    const testId = await createUiTest(`Flaky-${randomUUID()}`);
    const input = { testType: 'ui', testId, reason: 'Fails on Mondays.' };
    await request(app)
      .post('/api/v1/quarantine')
      .set(auth())
      .send({ ...input, reason: '' })
      .expect(400);
    await request(app)
      .post('/api/v1/quarantine')
      .set(auth(otherKey))
      .send(input)
      .expect(404)
      .expect((res) => expect(res.body.error.code).toBe('test_not_found'));
    await request(app).post('/api/v1/quarantine').set(auth(viewerKey)).send(input).expect(403);
    const created = await request(app)
      .post('/api/v1/quarantine')
      .set(auth())
      .send(input)
      .expect(201);
    expect(created.body).toEqual({
      id: expect.any(Number),
      testType: 'ui',
      testId,
      reason: 'Fails on Mondays.',
      quarantinedAt: expect.any(String),
      releasedAt: null,
      releaseNote: null,
    });
    await request(app)
      .post('/api/v1/quarantine')
      .set(auth())
      .send(input)
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('already_quarantined'));
    const listed = await request(app).get('/api/v1/quarantine').set(auth()).expect(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        testId,
        testName: expect.stringContaining('Flaky-'),
      }),
    ]);
    expect(listed.body.total).toBe(1);
    await request(app)
      .get('/api/v1/quarantine')
      .set(auth(otherKey))
      .expect(200)
      .expect((res) => expect(res.body.items).toEqual([]));

    const releasePath = `/api/v1/quarantine/${created.body.id}/release`;
    await request(app)
      .post(releasePath)
      .set(auth(otherKey))
      .expect(404)
      .expect((res) => expect(res.body.error.code).toBe('quarantine_not_found'));
    const released = await request(app)
      .post(releasePath)
      .set(auth())
      .send({ note: 'Fixed.' })
      .expect(200);
    expect(released.body).toMatchObject({ releasedAt: expect.any(String), releaseNote: 'Fixed.' });
    await request(app)
      .post(releasePath)
      .set(auth())
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('already_released'));
    const audits = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, String(testId)));
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(['test.quarantined', 'test.quarantine_released']),
    );
  });
});

describe('plan webhooks through /api/v1', () => {
  it('shows the token once, lists prefixes, and deletes', async () => {
    const planId = await createPlan(`Hooked ${randomUUID()}`);
    const path = `/api/v1/plans/${planId}/webhooks`;
    await request(app).post(path).set(auth(otherKey)).send({ name: 'CI' }).expect(404);
    await request(app).post(path).set(auth()).send({ name: '' }).expect(400);
    const viewerDenied = await request(app).get(path).set(auth(viewerKey)).expect(403);
    expect(viewerDenied.body.error.code).toBe('insufficient_role');
    const created = await request(app).post(path).set(auth()).send({ name: 'CI' }).expect(201);
    expect(created.body).toEqual({
      id: expect.any(Number),
      testPlanId: planId,
      name: 'CI',
      tokenPrefix: expect.any(String),
      createdAt: expect.any(String),
      lastUsedAt: null,
      token: expect.stringMatching(/^wfmwh_/),
    });
    expect(created.body.token.startsWith(created.body.tokenPrefix)).toBe(true);
    const listed = await request(app).get(path).set(auth()).expect(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({ id: created.body.id, name: 'CI' }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token);
    await request(app).get(path).set(auth(otherKey)).expect(404);
    const audits = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, String(created.body.id)));
    expect(JSON.stringify(audits)).not.toContain(created.body.token);

    await request(app)
      .delete(`/api/v1/webhooks/${created.body.id}`)
      .set(auth(otherKey))
      .expect(404);
    await request(app).delete(`/api/v1/webhooks/${created.body.id}`).set(auth()).expect(204);
    await request(app).delete(`/api/v1/webhooks/${created.body.id}`).set(auth()).expect(404);
    await request(app)
      .get(path)
      .set(auth())
      .expect(200)
      .expect((res) => expect(res.body.items).toEqual([]));
  });
});
