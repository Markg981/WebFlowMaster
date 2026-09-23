import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * The trail an owner reads to answer "who changed this, and from where?".
 *
 * What these hold: each change to a test, a plan, a schedule, an environment or a run leaves an
 * entry naming the person, the key if one was used, and the address; an update names the fields
 * it touched and never their values; a secret is recorded by name only; a change that did not
 * happen leaves nothing; and the trail can be filtered and exported without becoming a way to
 * smuggle a formula into a spreadsheet.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));
// Nothing here runs a browser or queues a run; without these the imports open Redis connections.
vi.mock('./browser-tasks', () => ({ browserTasks: {}, BrowserTaskError: class extends Error {} }));
vi.mock('./queue', () => ({ TEST_EXECUTION_QUEUE_NAME: 'test-queue', testExecutionQueue: { add: vi.fn() } }));
vi.mock('./scheduler-service', () => ({
  default: { addScheduleJob: vi.fn(), updateScheduleJob: vi.fn(), removeScheduleJob: vi.fn() },
  assertValidTimezone: vi.fn(),
}));

const { privilegedDb } = await import('./db');
const { auditLog, testPlanExecutions, testPlans, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { runWithTenant } = await import('./middleware/tenancy');
const { default: testsRoutes } = await import('./routes/tests.routes');
const { default: testPlansRoutes } = await import('./routes/test-plans.routes');
const { default: environmentRoutes } = await import('./routes/environments.routes');
const { default: organizationRoutes } = await import('./routes/organization.routes');

let app: express.Express;
let org: number;
let owner: { id: number; username: string; organizationId: number; role: string };
/** Set per test: which key, if any, the request came with. */
let viaKey: string | undefined;

beforeAll(async () => {
  org = await createTestOrganization('Audited Org');
  const [row] = await privilegedDb
    .insert(users)
    .values({ username: `auditor-${uuidv4().slice(0, 6)}`, password: 'x', organizationId: org, role: 'owner' })
    .returning();
  owner = { id: row.id, username: row.username, organizationId: org, role: 'owner' };

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = owner;
    (req as any).isAuthenticated = () => true;
    if (viaKey) (req as any).apiKeyId = viaKey;
    runWithTenant(org, () => next());
  });
  app.use(testsRoutes);
  app.use(testPlansRoutes);
  app.use(environmentRoutes);
  app.use(organizationRoutes);
});

beforeEach(async () => {
  viaKey = undefined;
  await privilegedDb.delete(auditLog).where(eq(auditLog.organizationId, org));
});

const trail = (action?: string) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(action ? and(eq(auditLog.organizationId, org), eq(auditLog.action, action)) : eq(auditLog.organizationId, org));

describe('a change to a test', () => {
  it('is recorded with who, from where, and through which key', async () => {
    viaKey = 'key-123';
    const created = await request(app)
      .post('/api/tests')
      .send({ name: `Checkout ${uuidv4().slice(0, 4)}`, url: 'https://shop.test', sequence: [], elements: [] })
      .expect(201);

    const [entry] = await trail('test.created');
    expect(entry).toMatchObject({
      actorUserId: owner.id,
      actorUsername: owner.username,
      apiKeyId: 'key-123',
      targetType: 'test',
      targetId: String(created.body.id),
      metadata: { name: created.body.name },
    });
    expect(entry.ipAddress).toBeTruthy();
  });

  it('names the fields an update touched, never their values', async () => {
    const created = await request(app)
      .post('/api/tests')
      .send({ name: `Login ${uuidv4().slice(0, 4)}`, url: 'https://shop.test', sequence: [], elements: [] })
      .expect(201);

    await request(app).put(`/api/tests/${created.body.id}`).send({ url: 'https://user:hunter2@shop.test' }).expect(200);

    const [entry] = await trail('test.updated');
    expect(entry.metadata).toEqual({ name: created.body.name, fields: ['url'] });
    expect(JSON.stringify(entry)).not.toContain('hunter2');
  });

  it('keeps the name of a deleted test, and records nothing for one that was not there', async () => {
    const created = await request(app)
      .post('/api/tests')
      .send({ name: `Doomed ${uuidv4().slice(0, 4)}`, url: 'https://shop.test', sequence: [], elements: [] })
      .expect(201);

    await request(app).delete(`/api/tests/${created.body.id}`).expect(204);
    await request(app).delete(`/api/tests/${created.body.id}`).expect(404);

    const deletions = await trail('test.deleted');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].metadata).toEqual({ name: created.body.name });
  });
});

describe('plans, schedules and runs', () => {
  it('records a plan, and a schedule switched off, as such', async () => {
    const plan = await request(app).post('/api/test-plans').send({ name: 'Nightly regression' }).expect(201);
    const schedule = await request(app)
      .post('/api/test-plan-schedules')
      .send({
        scheduleName: 'Every night',
        testPlanId: plan.body.id,
        frequency: 'daily',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
      })
      .expect(201);
    await request(app).put(`/api/test-plan-schedules/${schedule.body.id}`).send({ isActive: false }).expect(200);
    await request(app).delete(`/api/test-plan-schedules/${schedule.body.id}`).expect(204);

    const actions = (await trail()).map((e) => e.action).sort();
    expect(actions).toEqual(['plan.created', 'schedule.created', 'schedule.deleted', 'schedule.updated']);
    const [update] = await trail('schedule.updated');
    expect(update.metadata).toMatchObject({ name: 'Every night', isActive: false, fields: ['isActive'] });
  });

  it('records who stopped a run', async () => {
    const planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'P', userId: owner.id, organizationId: org } as any);
    const runId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: runId, organizationId: org, testPlanId: planId, status: 'queued' } as any);

    await request(app).post(`/api/test-plan-executions/${runId}/cancel`).expect(200);
    await request(app).post(`/api/test-plan-executions/${runId}/cancel`).expect(409);

    const cancellations = await trail('run.cancelled');
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]).toMatchObject({ targetId: runId, actorUserId: owner.id, metadata: { planId } });
  });
});

describe('environments and secrets', () => {
  it('records a secret by its name, never by its value', async () => {
    const environment = await request(app).post('/api/environments').send({ name: `Staging ${uuidv4().slice(0, 4)}` }).expect(201);
    await request(app)
      .post(`/api/environments/${environment.body.id}/secrets`)
      .send({ keyName: 'DB_PASSWORD', value: 's3cr3t-value' })
      .expect(201);

    const [secret] = await trail('secret.set');
    expect(secret.metadata).toEqual({ keyName: 'DB_PASSWORD', environmentId: environment.body.id });
    expect(JSON.stringify(await trail())).not.toContain('s3cr3t-value');
  });
});

describe('the actions', () => {
  // The settings page names each action through these; one without a label shows up as its
  // raw code, which is how a new action added without a thought for its readers would look.
  it('each has a label in every language, as does each category', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { AUDIT_ACTIONS } = await import('@shared/schema');
    for (const language of ['en', 'it', 'fr', 'de']) {
      const file = path.resolve(__dirname, '../client/src/locales', language, 'translation.json');
      const text = fs.readFileSync(file, 'utf8');
      const { auditLog: labels } = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      for (const action of Object.values(AUDIT_ACTIONS)) {
        expect(labels.actions[action.replace('.', '_')], `${language}: ${action}`).toBeTruthy();
        expect(labels.categories[action.split('.')[0]], `${language}: ${action.split('.')[0]}`).toBeTruthy();
      }
    }
  });
});

describe('reading the trail', () => {
  beforeEach(async () => {
    for (const name of ['A', 'B', 'C']) {
      await request(app).post('/api/test-plans').send({ name }).expect(201);
    }
    await request(app)
      .post('/api/tests')
      .send({ name: `=HYPERLINK("http://evil") ${uuidv4().slice(0, 4)}`, url: 'https://shop.test', sequence: [], elements: [] })
      .expect(201);
  });

  it('filters by category and by action, and says when there is more', async () => {
    const plans = await request(app).get('/api/organization/audit-log?category=plan&limit=2').expect(200);
    expect(plans.body.entries).toHaveLength(2);
    expect(plans.body.hasMore).toBe(true);
    expect(plans.body.entries.every((e: { action: string }) => e.action === 'plan.created')).toBe(true);

    const rest = await request(app).get('/api/organization/audit-log?category=plan&limit=2&offset=2').expect(200);
    expect(rest.body.entries).toHaveLength(1);
    expect(rest.body.hasMore).toBe(false);

    const tests = await request(app).get('/api/organization/audit-log?action=test.created').expect(200);
    expect(tests.body.entries).toHaveLength(1);
  });

  it('refuses an action or category it does not know', async () => {
    await request(app).get('/api/organization/audit-log?action=test.exploded').expect(400);
    await request(app).get('/api/organization/audit-log?category=everything').expect(400);
  });

  it('exports CSV in which a name cannot become a formula', async () => {
    const csv = await request(app).get('/api/organization/audit-log?format=csv').expect(200);

    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('createdAt,action,actorUsername,actorUserId,apiKeyId,ipAddress,targetType,targetId,metadata');
    expect(lines).toHaveLength(5);
    const testLine = lines.find((line) => line.includes('test.created'))!;
    // The name sits inside the metadata cell; nothing in the line starts a cell with "=".
    expect(testLine.split(',').some((cell) => cell.startsWith('='))).toBe(false);
  });

  it('is for owners only', async () => {
    const saved = owner;
    owner = { ...owner, role: 'editor' };
    try {
      await request(app).get('/api/organization/audit-log').expect(403);
    } finally {
      owner = saved;
    }
  });
});
