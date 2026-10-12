import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import { apiTests, auditLog, loadTestRuns, loadTests, testDataSets } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../../tests/factories';

/**
 * The load queue stood in: the route queues a job and the test executes it, the way the worker
 * does (server/api-tests/load-runner.ts, processLoadRunJob), so what is checked is the contract between
 * the two, without Redis.
 */
const queued = new Map<string, { id: string; state: string; remove: () => Promise<void> }>();
const queueAdd = vi.fn(async (_name: string, data: { runId: string }, opts: { jobId: string }) => {
  const job = {
    id: opts.jobId,
    state: 'waiting',
    remove: vi.fn(async () => {
      queued.delete(opts.jobId);
    }),
  };
  queued.set(opts.jobId, job);
  return { id: opts.jobId, data };
});
vi.mock('../../platform/queue', () => ({
  LOAD_QUEUE_NAME: 'load-queue',
  LOAD_RUN_JOB: 'load-run',
  loadQueue: {
    add: (...args: unknown[]) => queueAdd(...(args as Parameters<typeof queueAdd>)),
    getJob: async (id: string) => {
      const job = queued.get(id);
      return job ? { ...job, getState: async () => job.state } : null;
    },
  },
}));

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
 * Load tests through the API, against a stand-in shop: sign in with an e-mail, then read the cart
 * with the token the sign-in answered. The runs are real, a few seconds long, executed here as
 * the load worker would execute them.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let viewer: User;
let otherOrg: User;
let currentUser: User;
let login: number;
let cart: number;
let users: number;
let base: string;
const runs = new Map<string, Promise<void>>();

const shop = { logins: [] as string[], carts: [] as string[], tokens: new Set<string>() };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const json = (status: number, value: unknown) =>
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.method === 'POST' && req.url === '/login') {
      const { email } = JSON.parse(body || '{}');
      shop.logins.push(email);
      const token = `tok-${email}`;
      shop.tokens.add(token);
      return setTimeout(() => json(200, { token }), 5);
    }
    if (req.method === 'GET' && req.url === '/cart') {
      const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      shop.carts.push(token);
      return setTimeout(
        () => (shop.tokens.has(token) ? json(200, { items: [] }) : json(401, { error: 'who?' })),
        5,
      );
    }
    json(404, {});
  });
});

const status200 = (id: string) => ({
  id,
  source: 'status_code',
  comparison: 'equals',
  targetValue: '200',
  enabled: true,
});

beforeAll(async () => {
  organizationId = await createTestOrganization('Load Org');
  editor = {
    id: await createTestUser(organizationId, 'load-editor-' + uuidv4()),
    username: 'load-editor',
    organizationId,
    role: 'editor',
  };
  viewer = {
    id: await createTestUser(organizationId, 'load-viewer-' + uuidv4()),
    username: 'load-viewer',
    organizationId,
    role: 'viewer',
  };
  const otherOrganizationId = await createTestOrganization('Other Load Org');
  otherOrg = {
    id: await createTestUser(otherOrganizationId, 'load-other-' + uuidv4()),
    username: 'load-other',
    organizationId: otherOrganizationId,
    role: 'owner',
  };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  [{ id: login }] = await privilegedDb
    .insert(apiTests)
    .values({
      userId: editor.id,
      organizationId,
      name: 'Sign in',
      method: 'POST',
      url: `${base}/login`,
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{"email":"{{data.users.email}}"}',
      assertions: [status200('a1')],
      extractions: [{ id: 'x1', name: 'token', source: 'body_json_path', property: 'token' }],
    })
    .returning();
  [{ id: cart }] = await privilegedDb
    .insert(apiTests)
    .values({
      userId: editor.id,
      organizationId,
      name: 'Read the cart',
      method: 'GET',
      url: `${base}/cart`,
      requestHeaders: { Authorization: 'Bearer {{token}}' },
      assertions: [status200('a2')],
    })
    .returning();
  [{ id: users }] = await privilegedDb
    .insert(testDataSets)
    .values({
      organizationId,
      name: 'users',
      columns: ['email'],
      rows: [{ email: 'ann@shop.test' }, { email: 'bob@shop.test' }, { email: 'cy@shop.test' }],
    })
    .returning();

  const { default: routes } = await import('./load-tests.routes');
  const { loadRunnerDeps } = await import('../../api-tests/load-runner');
  Object.assign(loadRunnerDeps, { tickMs: 50, progressMs: 200 });
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), {
      userId: currentUser.id,
      role: currentUser.role,
    });
  });
  app.use(routes);
});

afterAll(async () => {
  await Promise.all(runs.values());
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await Promise.all(runs.values());
  await privilegedDb.delete(loadTests).where(eq(loadTests.organizationId, organizationId));
  currentUser = editor;
  shop.logins = [];
  shop.carts = [];
  queued.clear();
  queueAdd.mockClear();
  delete process.env.LOAD_MAX_VIRTUAL_USERS;
  delete process.env.LOAD_MAX_DURATION_S;
  delete process.env.LOAD_MAX_RUNS_PER_ORGANIZATION;
});

/** What the load worker does with the job the route queued: claims the run and executes it. */
function work(runId: string) {
  const run = (async () => {
    const { processLoadRunJob } = await import('../../api-tests/load-runner');
    const job = queueAdd.mock.calls.find(([, data]) => data.runId === runId);
    expect(job, `job of run ${runId}`).toBeDefined();
    const [, data] = job!;
    return processLoadRunJob(data as { runId: string; organizationId: number; userId: number }, {
      heartbeatMs: 100,
      workerId: 'test-worker:1',
    });
  })();
  // Registered before anything awaits, so `finished` always finds the run it must wait for.
  runs.set(
    runId,
    run.then(() => undefined),
  );
  return run;
}

/** Starts a run through the API and has the stand-in worker take it. */
async function startAndWork(testId: number) {
  const { body: started } = await request(app)
    .post(`/api/load-tests/${testId}/runs`)
    .send({})
    .expect(202);
  expect(started).toMatchObject({ status: 'queued', loadTestId: testId });
  const worked = work(started.id);
  return { started, worked };
}

const checkout = () => ({
  name: `Checkout ${uuidv4().slice(0, 6)}`,
  steps: [{ apiTestId: login }, { apiTestId: cart, thinkTimeMs: 50 }],
  stages: [
    { durationSec: 1, targetVus: 3 },
    { durationSec: 2, targetVus: 3 },
  ],
  warmUpSec: 1,
  dataSetId: users,
  dataMode: 'vu',
  thresholds: { errorRatePct: 0, p95Ms: 5_000 },
});

async function finished(runId: string) {
  await runs.get(runId);
  return (await request(app).get(`/api/load-test-runs/${runId}`).expect(200)).body;
}

describe('load tests', () => {
  it('queues a run for a load worker instead of running it in the web process', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const { body: started } = await request(app)
      .post(`/api/load-tests/${test.id}/runs`)
      .send({})
      .expect(202);
    expect(started).toMatchObject({ status: 'queued', loadTestId: test.id, summary: null });
    expect(started.definition).toBeUndefined();
    expect(started.jobId).toBeUndefined();
    expect(queueAdd).toHaveBeenCalledWith(
      'load-run',
      { runId: started.id, organizationId, userId: editor.id },
      { jobId: `load-${started.id}` },
    );
    const [row] = await privilegedDb
      .select()
      .from(loadTestRuns)
      .where(eq(loadTestRuns.id, started.id));
    expect(row).toMatchObject({ status: 'queued', jobId: `load-${started.id}`, workerId: null });
    expect(row.queuedAt).not.toBeNull();
    // Nothing ran: the shop heard nothing, and the page sees a queued run.
    expect(shop.logins).toEqual([]);
    const { body: polled } = await request(app)
      .get(`/api/load-test-runs/${started.id}`)
      .expect(200);
    expect(polled.status).toBe('queued');

    // The worker takes it: running, with its name, then the verdict.
    const outcome = await work(started.id);
    expect(outcome).toEqual({ outcome: 'done' });
    const [done] = await privilegedDb
      .select()
      .from(loadTestRuns)
      .where(eq(loadTestRuns.id, started.id));
    expect(done).toMatchObject({ status: 'passed', workerId: 'test-worker:1' });
    expect(done.heartbeatAt).not.toBeNull();
  });

  it('runs a scenario along its stages, each virtual user with its own row, and passes it', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const { started } = await startAndWork(test.id);

    const run = await finished(started.id);
    expect(run.status).toBe('passed');
    expect(run.error).toBeNull();
    expect(run.summary).toMatchObject({
      totalSec: 3,
      warmUpSec: 1,
      peakVus: 3,
      breaches: [],
      sampleErrors: [],
    });
    expect(run.summary.steps.map((s: { name: string }) => s.name)).toEqual([
      'Sign in',
      'Read the cart',
    ]);
    expect(run.summary.overall.requests).toBeGreaterThan(0);
    expect(run.summary.iterations.completed).toBeGreaterThan(0);
    expect(run.summary.timeline.length).toBeGreaterThan(0);
    // Three users, three rows, each user signing in as itself; each cart read with its own token.
    expect(new Set(shop.logins)).toEqual(
      new Set(['ann@shop.test', 'bob@shop.test', 'cy@shop.test']),
    );
    expect(shop.carts.every((token) => shop.tokens.has(token))).toBe(true);

    const { body: detail } = await request(app).get(`/api/load-tests/${test.id}`).expect(200);
    expect(detail.runs.map((r: { id: string }) => r.id)).toEqual([started.id]);
    const { body: list } = await request(app).get('/api/load-tests').expect(200);
    expect(list.find((t: { id: number }) => t.id === test.id).lastRun).toMatchObject({
      id: started.id,
      status: 'passed',
    });
    const audit = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, organizationId));
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['load_test.created', 'load_test.run']),
    );
  });

  it('fails a run that misses its thresholds, saying which', async () => {
    const { body: test } = await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), thresholds: { minRps: 100_000 } })
      .expect(201);
    const { started } = await startAndWork(test.id);
    const run = await finished(started.id);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^throughput [\d.]+ req\/s < 100000 req\/s$/);
  });

  it('runs one load test at a time per organization, and cancels a running one on request', async () => {
    const long = { ...checkout(), stages: [{ durationSec: 60, targetVus: 2 }], warmUpSec: 0 };
    const { body: test } = await request(app).post('/api/load-tests').send(long).expect(201);
    const { started, worked } = await startAndWork(test.id);
    // A queued run holds the organization's slot as a running one does.
    const second = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(409);
    expect(second.body.error).toMatch(/Another load test .* \(LOAD_MAX_RUNS_PER_ORGANIZATION\)/);
    await request(app).delete(`/api/load-tests/${test.id}`).expect(409);
    // Running, once the worker has it.
    await vi.waitFor(async () => {
      const { body } = await request(app).get(`/api/load-test-runs/${started.id}`).expect(200);
      expect(body.status).toBe('running');
    });

    currentUser = viewer;
    await request(app).post(`/api/load-test-runs/${started.id}/cancel`).expect(403);
    currentUser = editor;
    const { body: flagged } = await request(app)
      .post(`/api/load-test-runs/${started.id}/cancel`)
      .expect(202);
    // Still running: the worker stops it at its next progress, not the web process.
    expect(flagged).toMatchObject({ status: 'running', cancelRequested: true });
    await worked;
    const run = await finished(started.id);
    expect(run.status).toBe('cancelled');
    expect(run.summary.elapsedSec).toBeLessThan(30);
    await request(app).post(`/api/load-test-runs/${started.id}/cancel`).expect(409);
  });

  it('cancels a queued run by taking its job off the queue, and the worker skips it', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const { body: started } = await request(app)
      .post(`/api/load-tests/${test.id}/runs`)
      .send({})
      .expect(202);
    const { body: cancelled } = await request(app)
      .post(`/api/load-test-runs/${started.id}/cancel`)
      .expect(202);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect(cancelled.finishedAt).not.toBeNull();
    expect(queued.has(`load-${started.id}`)).toBe(false);
    // A worker that still gets the job (removed a moment too late) finds nothing to do.
    expect(await work(started.id)).toEqual({ outcome: 'skipped', reason: 'the run is cancelled' });
    expect(shop.logins).toEqual([]);
    // And the organization's slot is free again.
    const { started: next } = await startAndWork(test.id);
    expect((await finished(next.id)).status).toBe('passed');
  });

  it("refuses a profile beyond the installation's limits, naming the limit", async () => {
    process.env.LOAD_MAX_VIRTUAL_USERS = '2';
    const crowded = await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), dataMode: 'iteration' })
      .expect(400);
    expect(crowded.body.error).toBe(
      'A stage may ask for 2 virtual users at most (LOAD_MAX_VIRTUAL_USERS).',
    );
    const { body: limits } = await request(app).get('/api/load-tests/limits').expect(200);
    expect(limits).toMatchObject({ virtualUsers: 2, durationSec: 3600, runsPerOrganization: 1 });
    delete process.env.LOAD_MAX_VIRTUAL_USERS;

    process.env.LOAD_MAX_DURATION_S = '5';
    const long = await request(app)
      .post('/api/load-tests')
      .send({
        ...checkout(),
        stages: [
          { durationSec: 4, targetVus: 1 },
          { durationSec: 4, targetVus: 1 },
        ],
      })
      .expect(400);
    expect(long.body.error).toBe('The stages last 8 s; the limit is 5 s (LOAD_MAX_DURATION_S).');
    delete process.env.LOAD_MAX_DURATION_S;

    // A test saved under a higher limit than today's cannot be run either.
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    process.env.LOAD_MAX_VIRTUAL_USERS = '2';
    const refused = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(400);
    expect(refused.body.error).toBe(
      'The profile reaches 3 virtual users; the limit is 2 (LOAD_MAX_VIRTUAL_USERS).',
    );
  });

  it('lets an organization queue as many runs as LOAD_MAX_RUNS_PER_ORGANIZATION allows', async () => {
    process.env.LOAD_MAX_RUNS_PER_ORGANIZATION = '2';
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const { body: first } = await request(app)
      .post(`/api/load-tests/${test.id}/runs`)
      .send({})
      .expect(202);
    const { body: second } = await request(app)
      .post(`/api/load-tests/${test.id}/runs`)
      .send({})
      .expect(202);
    const third = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(409);
    expect(third.body.error).toBe(
      'The organization already has 2 load runs queued or running; the limit is 2 (LOAD_MAX_RUNS_PER_ORGANIZATION).',
    );
    for (const run of [first, second])
      await request(app).post(`/api/load-test-runs/${run.id}/cancel`).expect(202);
  });

  it('says why a run could not run when an API test it names is gone', async () => {
    const [{ id: doomed }] = await privilegedDb
      .insert(apiTests)
      .values({
        userId: editor.id,
        organizationId,
        name: 'Doomed',
        method: 'GET',
        url: `${base}/cart`,
      })
      .returning();
    const { body: test } = await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), steps: [{ apiTestId: doomed }], dataSetId: null })
      .expect(201);
    // Removed under the saved test: the save checked it, the run checks it again.
    await privilegedDb.delete(apiTests).where(eq(apiTests.id, doomed));
    const refused = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(400);
    expect(refused.body.error).toBe(`API test #${doomed} not found.`);
  });

  it('refuses a definition naming unknown API tests, or too few rows for its users', async () => {
    const unknown = await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), steps: [{ apiTestId: 999_999 }] })
      .expect(400);
    expect(unknown.body.error).toBe('API test #999999 not found.');
    const crowded = await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), stages: [{ durationSec: 10, targetVus: 4 }] })
      .expect(400);
    expect(crowded.body.error).toMatch(/3 rows for 4 virtual users/);
    // Rotating rows per iteration does not need one per user.
    await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), stages: [{ durationSec: 10, targetVus: 4 }], dataMode: 'iteration' })
      .expect(201);
    const invalid = await request(app)
      .post('/api/load-tests')
      .send({ ...checkout(), warmUpSec: 3 })
      .expect(400);
    expect(invalid.body.error).toMatch(/warm-up/);
  });

  it('lets viewers read but not write, and keeps each organization to its own', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    currentUser = viewer;
    await request(app).get(`/api/load-tests/${test.id}`).expect(200);
    await request(app).post('/api/load-tests').send(checkout()).expect(403);
    await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(403);
    currentUser = otherOrg;
    await request(app).get(`/api/load-tests/${test.id}`).expect(404);
    expect((await request(app).get('/api/load-tests').expect(200)).body).toEqual([]);
    await request(app).put(`/api/load-tests/${test.id}`).send(checkout()).expect(404);
    currentUser = editor;
    await request(app).delete(`/api/load-tests/${test.id}`).expect(204);
    expect(
      await privilegedDb.select().from(loadTestRuns).where(eq(loadTestRuns.loadTestId, test.id)),
    ).toEqual([]);
  });

  it('ends a run whose worker stopped heart-beating as worker lost, keeping its summary', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const id = uuidv4();
    const lastBeat = new Date(Date.now() - 5 * 60_000);
    await privilegedDb.insert(loadTestRuns).values({
      id,
      organizationId,
      loadTestId: test.id,
      status: 'running',
      definition: {},
      workerId: 'dead-worker:7',
      summary: { elapsedSec: 12 } as never,
      startedAt: new Date(Date.now() - 10 * 60_000),
      heartbeatAt: lastBeat,
    });
    // A run still beating, and one queued for hours, are left alone.
    const alive = uuidv4();
    await privilegedDb.insert(loadTestRuns).values({
      id: alive,
      organizationId,
      loadTestId: test.id,
      status: 'running',
      definition: {},
      startedAt: new Date(Date.now() - 10 * 60_000),
      heartbeatAt: new Date(),
    });
    const waiting = uuidv4();
    await privilegedDb.insert(loadTestRuns).values({
      id: waiting,
      organizationId,
      loadTestId: test.id,
      status: 'queued',
      definition: {},
      queuedAt: new Date(Date.now() - 3 * 3600_000),
      startedAt: new Date(Date.now() - 3 * 3600_000),
    });
    const { body: run } = await request(app).get(`/api/load-test-runs/${id}`).expect(200);
    expect(run.status).toBe('worker_lost');
    expect(run.error).toMatch(
      /^The worker running this stopped answering \(last heard from at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\)\. Its results up to then are kept; the run did not finish\.$/,
    );
    expect(run.summary).toEqual({ elapsedSec: 12 });
    expect(run.finishedAt).not.toBeNull();
    expect((await request(app).get(`/api/load-test-runs/${alive}`)).body.status).toBe('running');
    expect((await request(app).get(`/api/load-test-runs/${waiting}`)).body.status).toBe('queued');
    await privilegedDb.delete(loadTestRuns).where(eq(loadTestRuns.id, alive));
    await privilegedDb.delete(loadTestRuns).where(eq(loadTestRuns.id, waiting));
    // And the lost run no longer holds the organization's slot.
    const { started } = await startAndWork(test.id);
    expect((await finished(started.id)).status).toBe('passed');
  });
});
