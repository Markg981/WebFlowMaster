import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  apiTests,
  auditLog,
  impactRules,
  reportTestCaseResults,
  tags,
  testPlanExecutions,
  testPlans,
  testPlanSelectedTests,
  tests,
  testTags,
  users,
  type User,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { tenancyMiddleware } from './middleware/tenancy';
import { globToRegExp, validatePattern } from './test-impact';
import { readExecutionSnapshot } from './execution-snapshot';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
  updateLogLevel: vi.fn(),
}));
vi.mock('./queue', () => ({ TEST_EXECUTION_QUEUE_NAME: 'test-queue', testExecutionQueue: { add: vi.fn(async () => undefined) } }));

const { createExecutionOrchestrator } = await import('./execution-orchestrator');

/** Running the tests a change affects (server/test-impact.ts). */

describe('patterns', () => {
  it('reads globs the way git does', () => {
    const m = (pattern: string, file: string) => globToRegExp(pattern).test(file);
    expect(m('src/checkout/**', 'src/checkout/cart/Total.tsx')).toBe(true);
    expect(m('src/checkout/', 'src/checkout/a.ts')).toBe(true);
    expect(m('src/checkout/*', 'src/checkout/cart/Total.tsx')).toBe(false);
    expect(m('*.md', 'docs/guide/intro.md')).toBe(true);
    expect(m('**/*.{ts,tsx}', 'a/b.tsx')).toBe(true);
    expect(m('**/*.{ts,tsx}', 'a/b.js')).toBe(false);
    expect(m('./server/**/*.ts', 'server/x/y.ts')).toBe(true);
    expect(m('server/**/*.ts', 'server/y.ts')).toBe(true);
    expect(m('a?.txt', 'ab.txt')).toBe(true);
    expect(validatePattern('  ')).toMatch(/required/);
    expect(validatePattern('src/**')).toBeNull();
  });
});

describe('a run narrowed to what a change affects', () => {
  let app: Application;
  let user: User;
  let organizationId: number;
  let planId: string;
  const ids: Record<string, number> = {};
  const tagIds: Record<string, string> = {};

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = user;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    app.use(tenancyMiddleware);
    app.use((await import('./routes/impact-rules.routes')).default);
  });

  beforeEach(async () => {
    await privilegedDb.delete(auditLog);
    await privilegedDb.delete(impactRules);
    await privilegedDb.delete(reportTestCaseResults);
    await privilegedDb.delete(testPlanExecutions);
    await privilegedDb.delete(testPlanSelectedTests);
    await privilegedDb.delete(testPlans);
    await privilegedDb.delete(testTags);
    await privilegedDb.delete(tags);
    await privilegedDb.delete(tests);
    await privilegedDb.delete(apiTests);
    organizationId = await createTestOrganization(`Impact ${Math.random()}`);
    [user] = await privilegedDb.insert(users).values({ username: `impact-${uuidv4()}`, password: 'x.y', organizationId, role: 'editor' }).returning();
    for (const name of ['checkout', 'search']) {
      tagIds[name] = uuidv4();
      await privilegedDb.insert(tags).values({ id: tagIds[name], name, organizationId });
    }
    planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId: user.id, organizationId } as any);
    // Checkout (tagged checkout), Search (tagged search), Smoke (no tag), Orders API (tagged checkout).
    for (const [name, tag] of [['Checkout', 'checkout'], ['Search', 'search'], ['Smoke', null]] as const) {
      const [t] = await privilegedDb.insert(tests).values({ name, url: 'https://x.example', sequence: [], elements: [], userId: user.id, organizationId }).returning();
      ids[name] = t.id;
      await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId: t.id, organizationId } as any);
      if (tag) await privilegedDb.insert(testTags).values({ organizationId, tagId: tagIds[tag], testId: t.id, testType: 'ui' });
    }
    const [api] = await privilegedDb.insert(apiTests).values({ name: 'Orders API', method: 'GET', url: 'https://x.example/orders', userId: user.id, organizationId }).returning();
    ids['Orders API'] = api.id;
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'api', apiTestId: api.id, organizationId } as any);
    await privilegedDb.insert(testTags).values({ organizationId, tagId: tagIds.checkout, apiTestId: api.id, testType: 'api' });
  });

  const addRule = (pattern: string, tag: string | null) =>
    request(app).post('/api/impact-rules').send({ pattern, tagId: tag ? tagIds[tag] : null });
  const preview = (changedFiles: string[]) =>
    request(app).post('/api/impact-rules/preview').send({ planId, changedFiles }).expect(200);
  const names = (res: request.Response) => res.body.tests.map((t: { name: string }) => t.name).sort();

  it('runs everything without a map, and says so', async () => {
    const res = await preview(['src/checkout/cart.ts']);
    expect(res.body.selection).toMatchObject({ mode: 'all', selected: 4, total: 4 });
    expect(res.body.selection.reason).toMatch(/No impact map/);
  });

  it('runs the tests of the affected tags and those the map does not cover', async () => {
    await addRule('src/checkout/**', 'checkout').expect(201);
    await addRule('src/search/**', 'search').expect(201);
    await addRule('docs/**', null).expect(201);

    const res = await preview(['src/checkout/cart.ts', 'docs/readme.md']);
    expect(res.body.selection).toMatchObject({ mode: 'affected', selected: 3, total: 4, affectedTags: ['checkout'] });
    expect(names(res)).toEqual(['Checkout', 'Orders API', 'Smoke']);

    // Only documentation changed: only what the map does not cover.
    expect(names(await preview(['docs/x.md']))).toEqual(['Smoke']);

    // A file no rule matches: everything, and which file decided it.
    const unmapped = await preview(['src/checkout/cart.ts', 'package.json']);
    expect(unmapped.body.selection).toMatchObject({ mode: 'all', selected: 4, unmappedFiles: ['package.json'] });
  });

  it('also runs what failed in the last finished run', async () => {
    await addRule('src/checkout/**', 'checkout').expect(201);
    await addRule('src/search/**', 'search').expect(201);
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'failed', triggeredBy: 'manual', completedAt: new Date() } as any);
    await privilegedDb.insert(reportTestCaseResults).values({ id: uuidv4(), organizationId, testPlanExecutionId: executionId, uiTestId: ids.Search, testType: 'ui', testName: 'Search', status: 'Failed', startedAt: new Date(), completedAt: new Date(), durationMs: 1 } as any);

    const res = await preview(['src/checkout/cart.ts']);
    expect(names(res)).toEqual(['Checkout', 'Orders API', 'Search', 'Smoke']);
    expect(res.body.selection.previouslyFailed).toBe(1);
  });

  it('narrows a run asked for with changed files, and keeps the decision on it', async () => {
    await addRule('src/checkout/**', 'checkout').expect(201);
    await addRule('src/search/**', 'search').expect(201);
    const orchestrator = createExecutionOrchestrator({ add: async () => undefined });
    const execution = await orchestrator.enqueue({ planId, requestedByUserId: user.id, trigger: 'api', changedFiles: ['src/search/box.tsx'] });
    const snapshot = readExecutionSnapshot(execution.configurationSnapshot)!;
    expect(snapshot.selectedTests.map((t) => t.testId ?? t.apiTestId).sort()).toEqual([ids.Search, ids.Smoke].sort());
    expect(snapshot.selection).toMatchObject({ mode: 'affected', affectedTags: ['search'], selected: 2, total: 4 });

    // Without changed files, the plan as always.
    const full = await orchestrator.enqueue({ planId, requestedByUserId: user.id, trigger: 'api' });
    expect(readExecutionSnapshot(full.configurationSnapshot)!.selectedTests).toHaveLength(4);
  });

  it('keeps the map tidy, audited, and within the organization', async () => {
    await addRule('src/checkout/**', 'checkout').expect(201);
    await addRule('src/checkout/**', 'checkout').expect(409);
    await addRule('', 'checkout').expect(400);
    const list = await request(app).get('/api/impact-rules').expect(200);
    expect(list.body).toMatchObject([{ pattern: 'src/checkout/**', tagName: 'checkout' }]);
    await request(app).delete(`/api/impact-rules/${list.body[0].id}`).expect(204);
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(audit.map((a) => a.action).sort()).toEqual(['impact_rule.created', 'impact_rule.deleted']);

    // A tag of another organization is not found.
    const otherOrg = await createTestOrganization('Elsewhere');
    const foreign = uuidv4();
    await privilegedDb.insert(tags).values({ id: foreign, name: 'theirs', organizationId: otherOrg });
    await request(app).post('/api/impact-rules').send({ pattern: 'a/**', tagId: foreign }).expect(400);
  });
});
