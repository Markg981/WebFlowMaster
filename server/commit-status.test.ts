import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { auditLog, sourceHosts, testPlanExecutions, testPlans, type TestPlanExecution } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { encryptSecret } from './crypto';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * A run's result on the commit it tested.
 *
 * What is worth a test: a run started from GitHub or GitLab shows on its commit as it goes —
 * pending, running, then the verdict with the report link — in that order, under one check name
 * per plan; nothing is sent for a run with no commit, a short commit, another CI, or an organization
 * that has not connected the host, nor with another organization's token; a refusal is recorded on
 * the host in words; connecting checks the token before keeping it, is for owners, and never gives
 * the token back.
 */

const { commitStatusFor, commitTargetOf, postCommitStatus, registerCommitStatus } = await import('./commit-status');
const { announceExecution, takeExecution, transitionExecution } = await import('./execution-state');
const { runWithTenant } = await import('./middleware/tenancy');
const { default: sourceHostsRoutes } = await import('./routes/source-hosts.routes');

const SHA = 'a'.repeat(40);

/** GitHub and GitLab in miniature: who the token is, and every status set, in order. */
interface Received {
  method: string;
  path: string;
  auth: string | undefined;
  body: any;
}
const received: Received[] = [];
let refuseWith: number | null = null;
let fake: http.Server;
let fakeUrl: string;

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const auth = (req.headers.authorization ?? req.headers['private-token']) as string | undefined;
      received.push({ method: req.method!, path: req.url!, auth, body: raw ? JSON.parse(raw) : null });
      res.setHeader('Content-Type', 'application/json');
      if (!auth || /wrong/.test(auth)) return res.writeHead(401).end(JSON.stringify({ message: 'Bad credentials' }));
      if (refuseWith) return res.writeHead(refuseWith).end(JSON.stringify({ message: 'Not Found' }));
      if (req.url!.endsWith('/user')) return res.end(JSON.stringify(req.headers['private-token'] ? { username: 'gl-bot' } : { login: 'gh-bot' }));
      res.writeHead(201).end('{}');
    });
  });
  fakeUrl = await new Promise<string>((resolve) =>
    fake.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(fake.address() as AddressInfo).port}`)),
  );
});

afterAll(async () => {
  await new Promise((resolve) => fake.close(resolve));
});

beforeEach(() => {
  received.length = 0;
  refuseWith = null;
});

const statuses = () => received.filter((r) => r.method === 'POST');

describe('what a run says on its commit', () => {
  it('points only at a full commit of a repository on GitHub or GitLab', () => {
    expect(commitTargetOf({ provider: 'github', repository: 'acme/shop', commit: SHA.toUpperCase() })).toEqual({ provider: 'github', repository: 'acme/shop', commit: SHA });
    expect(commitTargetOf({ provider: 'gitlab', repository: 'group/sub/app', commit: SHA })).toMatchObject({ provider: 'gitlab' });
    expect(commitTargetOf({ provider: 'github', repository: 'acme/shop', commit: 'abc1234' })).toBeNull();
    expect(commitTargetOf({ provider: 'github', commit: SHA })).toBeNull();
    expect(commitTargetOf({ provider: 'jenkins', repository: 'acme/shop', commit: SHA })).toBeNull();
    expect(commitTargetOf(null)).toBeNull();
  });

  it('describes each state in a line, under one name per plan', () => {
    const run = (patch: Partial<TestPlanExecution>) =>
      ({ status: 'queued', totalTests: 40, passedTests: 37, failedTests: 3, quarantinedFailures: 0, attempt: 1, maxAttempts: 1, failureMessage: null, ...patch }) as TestPlanExecution;
    const say = (patch: Partial<TestPlanExecution>) => commitStatusFor(run(patch), 'Checkout', 'https://wfm.test/report');

    expect(say({ status: 'queued' })).toEqual({ state: 'pending', description: 'Queued', context: 'WebFlowMaster / Checkout', targetUrl: 'https://wfm.test/report' });
    expect(say({ status: 'running', attempt: 2, maxAttempts: 3 })).toMatchObject({ state: 'running', description: 'Running (attempt 2 of 3)' });
    expect(say({ status: 'failed' })).toMatchObject({ state: 'failure', description: '3 of 40 failed' });
    expect(say({ status: 'completed', passedTests: 38, failedTests: 0, quarantinedFailures: 2 })).toMatchObject({ state: 'success', description: '38 of 40 passed, 2 quarantined failures ignored' });
    expect(say({ status: 'timed_out', passedTests: 10, failedTests: 1 })).toMatchObject({ state: 'error', description: 'Timed out after 11 of 40 tests' });
    expect(say({ status: 'cancelled' })).toMatchObject({ state: 'cancelled', description: 'Cancelled' });
    expect(say({ status: 'error', failureMessage: 'x'.repeat(300) })!.description).toHaveLength(140);
    expect(say({ status: 'cancelling' })).toBeNull();
    expect(commitStatusFor(run({}), 'Checkout')).not.toHaveProperty('targetUrl');
  });
});

describe('talking to GitHub and GitLab', () => {
  const status = { state: 'failure', description: '3 of 40 failed', context: 'WebFlowMaster / Checkout', targetUrl: 'https://wfm.test/r' } as const;

  it('sets a GitHub status in GitHub\'s words', async () => {
    const error = await postCommitStatus({ provider: 'github', apiUrl: `${fakeUrl}/`, token: 'ghp_ok' }, { repository: 'acme/shop', commit: SHA }, status);
    expect(error).toBeNull();
    expect(received[0]).toMatchObject({
      path: `/repos/acme/shop/statuses/${SHA}`,
      auth: 'Bearer ghp_ok',
      body: { state: 'failure', description: '3 of 40 failed', context: 'WebFlowMaster / Checkout', target_url: 'https://wfm.test/r' },
    });
  });

  it('sets a GitLab status in GitLab\'s words, with the project path encoded', async () => {
    await postCommitStatus({ provider: 'gitlab', apiUrl: `${fakeUrl}/api/v4`, token: 'glpat_ok' }, { repository: 'group/sub/app', commit: SHA }, { ...status, state: 'cancelled' });
    expect(received[0]).toMatchObject({
      path: `/api/v4/projects/group%2Fsub%2Fapp/statuses/${SHA}`,
      auth: 'glpat_ok',
      body: { state: 'canceled', name: 'WebFlowMaster / Checkout' },
    });
  });

  it('says why in words when it is refused or cannot reach the host', async () => {
    expect(await postCommitStatus({ provider: 'github', apiUrl: fakeUrl, token: 'wrong' }, { repository: 'acme/shop', commit: SHA }, status)).toBe(
      'GitHub answered 401 (Bad credentials): the token is not valid.',
    );
    refuseWith = 404;
    expect(await postCommitStatus({ provider: 'github', apiUrl: fakeUrl, token: 'ghp_ok' }, { repository: 'acme/shop', commit: SHA }, status)).toBe(
      'GitHub answered 404 (Not Found): the token cannot set statuses on acme/shop, or the repository is not there.',
    );
    expect(await postCommitStatus({ provider: 'github', apiUrl: 'http://127.0.0.1:9', token: 'x' }, { repository: 'a/b', commit: SHA }, status)).toMatch(
      /^Could not reach http:\/\/127\.0\.0\.1:9: /,
    );
  });
});

describe('a run reporting on its commit as it goes', () => {
  let organizationId: number;
  let otherOrganizationId: number;
  let userId: number;
  let unregister: () => void;

  beforeAll(async () => {
    organizationId = await createTestOrganization('Commit Status Org');
    otherOrganizationId = await createTestOrganization('Other Commit Status Org');
    userId = await createTestUser(organizationId, 'commit-status-owner');
  });

  beforeEach(async () => {
    await privilegedDb.delete(sourceHosts);
    unregister = registerCommitStatus();
  });

  afterEach(() => unregister());

  async function connect(org: number, provider: 'github' | 'gitlab', token = 'ghp_ok') {
    const secret = encryptSecret(token);
    await privilegedDb.insert(sourceHosts).values({
      id: randomUUID(),
      organizationId: org,
      provider,
      apiUrl: provider === 'github' ? fakeUrl : `${fakeUrl}/api/v4`,
      encryptedToken: secret.encryptedValue,
      tokenIv: secret.iv,
      tokenAuthTag: secret.authTag,
    });
  }

  /** A run as the enqueue path makes it, told to the listeners the way the orchestrator does. */
  async function queuedRun(ci: unknown): Promise<string> {
    const planId = randomUUID();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Checkout', userId, organizationId } as never);
    const [run] = await privilegedDb
      .insert(testPlanExecutions)
      .values({
        id: randomUUID(),
        organizationId,
        testPlanId: planId,
        status: 'queued',
        triggeredBy: 'api',
        ciContext: ci as never,
        configurationSnapshot: { version: 1, plan: { id: planId, name: 'Checkout', updatedAt: null }, selectedTests: [] },
      })
      .returning();
    announceExecution(run);
    return run.id;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('goes pending, running, then the verdict — in order, under one name, with the report link', async () => {
    await connect(organizationId, 'github');
    const ci = { provider: 'github', repository: 'acme/shop', commit: SHA };
    vi.stubEnv('WEBFLOW_PUBLIC_URL', 'https://wfm.example.test/');
    let id = '';
    await runWithTenant(organizationId, async () => {
      id = await queuedRun(ci);
      await takeExecution(id);
      await transitionExecution(id, 'failed', { totalTests: 40, passedTests: 37, failedTests: 3 });
    });
    await expect.poll(() => statuses().length).toBe(3);

    expect(statuses().map((s) => [s.body.state, s.body.description])).toEqual([
      ['pending', 'Queued'],
      ['pending', 'Running'],
      ['failure', '3 of 40 failed'],
    ]);
    expect(new Set(statuses().map((s) => s.body.context))).toEqual(new Set(['WebFlowMaster / Checkout']));
    const [run] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(statuses()[2].body.target_url).toBe(`https://wfm.example.test/test-plans/${run.testPlanId}/executions/${id}/report`);
    vi.unstubAllEnvs();
    const [host] = await privilegedDb.select().from(sourceHosts);
    expect(host.lastDeliveryAt).not.toBeNull();
    expect(host.lastDeliveryError).toBeNull();
  });

  it('sends nothing without a commit to report on, or without a connected host of that provider', async () => {
    await connect(organizationId, 'gitlab');
    await connect(otherOrganizationId, 'github');
    await runWithTenant(organizationId, async () => {
      // No CI, a short commit, another CI system: nothing to point at.
      for (const ci of [null, { provider: 'github', repository: 'acme/shop', commit: 'abc1234' }, { provider: 'jenkins', repository: 'acme/shop', commit: SHA }]) {
        const id = await queuedRun(ci);
        await transitionExecution(id, 'error', { failureMessage: 'nope' });
      }
      // A GitHub run, with only GitLab connected here — and another organization's GitHub token
      // is not this organization's to use.
      await queuedRun({ provider: 'github', repository: 'acme/shop', commit: SHA });
    });
    await settle();
    expect(statuses()).toEqual([]);
  });

  it('records on the host why the status was refused', async () => {
    await connect(organizationId, 'github', 'wrong-token');
    await runWithTenant(organizationId, () => queuedRun({ provider: 'github', repository: 'acme/shop', commit: SHA }));
    await expect.poll(async () => (await privilegedDb.select().from(sourceHosts))[0]?.lastDeliveryError).toBe(
      'GitHub answered 401 (Bad credentials): the token is not valid.',
    );
  });

  it('is off in a process that has not asked for it', async () => {
    unregister();
    await connect(organizationId, 'github');
    await runWithTenant(organizationId, () => queuedRun({ provider: 'github', repository: 'acme/shop', commit: SHA }));
    await settle();
    expect(statuses()).toEqual([]);
  });
});

describe('/api/source-hosts', () => {
  let app: express.Express;
  let organizationId: number;
  let userId: number;
  let role = 'owner';

  beforeAll(async () => {
    organizationId = await createTestOrganization('Source Hosts Org');
    userId = await createTestUser(organizationId, 'source-hosts-owner');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: userId, username: 'source-hosts-owner', organizationId, role };
      (req as any).isAuthenticated = () => true;
      runWithTenant(organizationId, () => next());
    });
    app.use(sourceHostsRoutes);
  });

  beforeEach(async () => {
    role = 'owner';
    await privilegedDb.delete(sourceHosts);
    await privilegedDb.delete(auditLog);
  });

  it('checks the token before keeping it, keeps it encrypted, and never gives it back', async () => {
    const refused = await request(app).put('/api/source-hosts/github').send({ apiUrl: fakeUrl, token: 'wrong-token' }).expect(400);
    expect(refused.body.error).toBe('GitHub answered 401 (Bad credentials): the token is not valid.');
    expect(await privilegedDb.select().from(sourceHosts)).toEqual([]);

    const saved = await request(app).put('/api/source-hosts/github').send({ apiUrl: `${fakeUrl}/`, token: 'ghp_secret' }).expect(200);
    expect(saved.body).toMatchObject({ provider: 'github', apiUrl: fakeUrl, account: 'gh-bot' });
    const [row] = await privilegedDb.select().from(sourceHosts);
    expect(JSON.stringify(row)).not.toContain('ghp_secret');

    const listing = await request(app).get('/api/source-hosts').expect(200);
    expect(JSON.stringify(listing.body)).not.toContain('ghp_secret');
    expect(listing.body).toEqual([expect.objectContaining({ provider: 'github', lastDeliveryError: null })]);

    expect((await request(app).post('/api/source-hosts/github/test').expect(200)).body).toEqual({ ok: true, account: 'gh-bot' });
  });

  it('replaces rather than duplicates, and records connecting and removing', async () => {
    await request(app).put('/api/source-hosts/gitlab').send({ apiUrl: `${fakeUrl}/api/v4`, token: 'glpat_1' }).expect(200);
    await request(app).put('/api/source-hosts/gitlab').send({ apiUrl: `${fakeUrl}/api/v4`, token: 'glpat_2' }).expect(200);
    expect(await privilegedDb.select().from(sourceHosts).where(eq(sourceHosts.organizationId, organizationId))).toHaveLength(1);

    await request(app).delete('/api/source-hosts/gitlab').expect(204);
    await request(app).delete('/api/source-hosts/gitlab').expect(404);
    const actions = (await privilegedDb.select().from(auditLog)).map((e) => e.action).sort();
    expect(actions).toEqual(['source_host.connected', 'source_host.connected', 'source_host.removed']);
    expect(JSON.stringify(await privilegedDb.select().from(auditLog))).not.toContain('glpat_');
  });

  it('is for owners, and knows only the two providers', async () => {
    role = 'editor';
    await request(app).put('/api/source-hosts/github').send({ apiUrl: fakeUrl, token: 'ghp_x' }).expect(403);
    await request(app).get('/api/source-hosts').expect(200);
    role = 'owner';
    await request(app).put('/api/source-hosts/bitbucket').send({ token: 'x' }).expect(404);
  });
});
