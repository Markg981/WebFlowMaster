import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { apiTests, auditLog, loadTestRuns, loadTests, testDataSets } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Load tests through the API, against a stand-in shop: sign in with an e-mail, then read the cart
 * with the token the sign-in answered. The runs are real, a few seconds long.
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
    const json = (status: number, value: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
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
      return setTimeout(() => (shop.tokens.has(token) ? json(200, { items: [] }) : json(401, { error: 'who?' })), 5);
    }
    json(404, {});
  });
});

const status200 = (id: string) => ({ id, source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true });

beforeAll(async () => {
  organizationId = await createTestOrganization('Load Org');
  editor = { id: await createTestUser(organizationId, 'load-editor-' + uuidv4()), username: 'load-editor', organizationId, role: 'editor' };
  viewer = { id: await createTestUser(organizationId, 'load-viewer-' + uuidv4()), username: 'load-viewer', organizationId, role: 'viewer' };
  const otherOrganizationId = await createTestOrganization('Other Load Org');
  otherOrg = { id: await createTestUser(otherOrganizationId, 'load-other-' + uuidv4()), username: 'load-other', organizationId: otherOrganizationId, role: 'owner' };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  [{ id: login }] = await privilegedDb.insert(apiTests).values({
    userId: editor.id, organizationId, name: 'Sign in', method: 'POST', url: `${base}/login`,
    requestHeaders: { 'Content-Type': 'application/json' },
    requestBody: '{"email":"{{data.users.email}}"}',
    assertions: [status200('a1')],
    extractions: [{ id: 'x1', name: 'token', source: 'body_json_path', property: 'token' }],
  }).returning();
  [{ id: cart }] = await privilegedDb.insert(apiTests).values({
    userId: editor.id, organizationId, name: 'Read the cart', method: 'GET', url: `${base}/cart`,
    requestHeaders: { Authorization: 'Bearer {{token}}' },
    assertions: [status200('a2')],
  }).returning();
  [{ id: users }] = await privilegedDb.insert(testDataSets).values({
    organizationId, name: 'users', columns: ['email'],
    rows: [{ email: 'ann@shop.test' }, { email: 'bob@shop.test' }, { email: 'cy@shop.test' }],
  }).returning();

  const { default: routes, loadRunner } = await import('./load-tests.routes');
  const { loadRunnerDeps, executeLoadRun } = await import('../load-runner');
  Object.assign(loadRunnerDeps, { tickMs: 50, progressMs: 200 });
  loadRunner.start = (runId, org, userId) => {
    const run = executeLoadRun(runId, org, userId);
    runs.set(runId, run);
    return run;
  };
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
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
});

const checkout = () => ({
  name: `Checkout ${uuidv4().slice(0, 6)}`,
  steps: [{ apiTestId: login }, { apiTestId: cart, thinkTimeMs: 50 }],
  stages: [{ durationSec: 1, targetVus: 3 }, { durationSec: 2, targetVus: 3 }],
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
  it('runs a scenario along its stages, each virtual user with its own row, and passes it', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const { body: started } = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(202);
    expect(started).toMatchObject({ status: 'running', loadTestId: test.id });
    expect(started.definition).toBeUndefined();

    const run = await finished(started.id);
    expect(run.status).toBe('passed');
    expect(run.error).toBeNull();
    expect(run.summary).toMatchObject({ totalSec: 3, warmUpSec: 1, peakVus: 3, breaches: [], sampleErrors: [] });
    expect(run.summary.steps.map((s: { name: string }) => s.name)).toEqual(['Sign in', 'Read the cart']);
    expect(run.summary.overall.requests).toBeGreaterThan(0);
    expect(run.summary.iterations.completed).toBeGreaterThan(0);
    expect(run.summary.timeline.length).toBeGreaterThan(0);
    // Three users, three rows, each user signing in as itself; each cart read with its own token.
    expect(new Set(shop.logins)).toEqual(new Set(['ann@shop.test', 'bob@shop.test', 'cy@shop.test']));
    expect(shop.carts.every((token) => shop.tokens.has(token))).toBe(true);

    const { body: detail } = await request(app).get(`/api/load-tests/${test.id}`).expect(200);
    expect(detail.runs.map((r: { id: string }) => r.id)).toEqual([started.id]);
    const { body: list } = await request(app).get('/api/load-tests').expect(200);
    expect(list.find((t: { id: number }) => t.id === test.id).lastRun).toMatchObject({ id: started.id, status: 'passed' });
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(['load_test.created', 'load_test.run']));
  });

  it('fails a run that misses its thresholds, saying which', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send({ ...checkout(), thresholds: { minRps: 100_000 } }).expect(201);
    const { body: started } = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(202);
    const run = await finished(started.id);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^throughput [\d.]+ req\/s < 100000 req\/s$/);
  });

  it('runs one load test at a time per organization, and cancels on request', async () => {
    const long = { ...checkout(), stages: [{ durationSec: 60, targetVus: 2 }], warmUpSec: 0 };
    const { body: test } = await request(app).post('/api/load-tests').send(long).expect(201);
    const { body: started } = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(202);
    const second = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(409);
    expect(second.body.error).toMatch(/Another load test/);
    await request(app).delete(`/api/load-tests/${test.id}`).expect(409);

    currentUser = viewer;
    await request(app).post(`/api/load-test-runs/${started.id}/cancel`).expect(403);
    currentUser = editor;
    await request(app).post(`/api/load-test-runs/${started.id}/cancel`).expect(202);
    const run = await finished(started.id);
    expect(run.status).toBe('cancelled');
    expect(run.summary.elapsedSec).toBeLessThan(30);
    await request(app).post(`/api/load-test-runs/${started.id}/cancel`).expect(409);
  });

  it('says why a run could not run when an API test it names is gone', async () => {
    const [{ id: doomed }] = await privilegedDb.insert(apiTests).values({
      userId: editor.id, organizationId, name: 'Doomed', method: 'GET', url: `${base}/cart`,
    }).returning();
    const { body: test } = await request(app).post('/api/load-tests').send({ ...checkout(), steps: [{ apiTestId: doomed }], dataSetId: null }).expect(201);
    // Removed under the saved test: the save checked it, the run checks it again.
    await privilegedDb.delete(apiTests).where(eq(apiTests.id, doomed));
    const refused = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(400);
    expect(refused.body.error).toBe(`API test #${doomed} not found.`);
  });

  it('refuses a definition naming unknown API tests, or too few rows for its users', async () => {
    const unknown = await request(app).post('/api/load-tests').send({ ...checkout(), steps: [{ apiTestId: 999_999 }] }).expect(400);
    expect(unknown.body.error).toBe('API test #999999 not found.');
    const crowded = await request(app).post('/api/load-tests').send({ ...checkout(), stages: [{ durationSec: 10, targetVus: 4 }] }).expect(400);
    expect(crowded.body.error).toMatch(/3 rows for 4 virtual users/);
    // Rotating rows per iteration does not need one per user.
    await request(app).post('/api/load-tests').send({ ...checkout(), stages: [{ durationSec: 10, targetVus: 4 }], dataMode: 'iteration' }).expect(201);
    const invalid = await request(app).post('/api/load-tests').send({ ...checkout(), warmUpSec: 3 }).expect(400);
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
    expect(await privilegedDb.select().from(loadTestRuns).where(eq(loadTestRuns.loadTestId, test.id))).toEqual([]);
  });

  it('closes a run whose server stopped heart-beating', async () => {
    const { body: test } = await request(app).post('/api/load-tests').send(checkout()).expect(201);
    const id = uuidv4();
    await privilegedDb.insert(loadTestRuns).values({
      id, organizationId, loadTestId: test.id, status: 'running', definition: {},
      startedAt: new Date(Date.now() - 10 * 60_000), heartbeatAt: new Date(Date.now() - 5 * 60_000),
    });
    const { body: run } = await request(app).get(`/api/load-test-runs/${id}`).expect(200);
    expect(run).toMatchObject({ status: 'error', error: 'Interrupted: the server running it stopped.' });
    // And it no longer holds the organization's slot.
    const { body: started } = await request(app).post(`/api/load-tests/${test.id}/runs`).send({}).expect(202);
    await finished(started.id);
  });
});
