import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

/**
 * Restricting a project, through the routes and the real tenancy middleware.
 *
 * What these hold: the project list says what each member may do and hides what they may not
 * see; only owners change who is on a project, and only with people of their own organization;
 * the change is recorded; and a viewer on a project is told the test is read-only rather than
 * that it does not exist.
 */

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));
vi.mock('../browser-tasks', () => ({ browserTasks: {}, BrowserTaskError: class extends Error {} }));
vi.mock('../queue', () => ({ TEST_EXECUTION_QUEUE_NAME: 'q', testExecutionQueue: { add: vi.fn() } }));

const { privilegedDb } = await import('../db');
const { auditLog, projects, tests, users } = await import('@shared/schema');
const { createTestOrganization } = await import('../tests/factories');
const { tenancyMiddleware } = await import('../middleware/tenancy');
const { default: projectsRoutes, effectiveProjectRole } = await import('./projects.routes');
const { default: testsRoutes } = await import('./tests.routes');

type Person = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let current: Person;
let org: number;
let owner: Person;
let alice: Person;
let bob: Person;
let carol: Person;
let reader: Person;
let secret: number;

async function person(name: string, role: string, organizationId = org): Promise<Person> {
  const [row] = await privilegedDb.insert(users).values({ username: `${name}-${Math.random()}`, password: 'x', organizationId, role }).returning();
  return { id: row.id, username: row.username, organizationId, role };
}

const as = (who: Person) => {
  current = who;
  return request(app);
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = current;
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(tenancyMiddleware);
  app.use(projectsRoutes);
  app.use(testsRoutes);
});

beforeEach(async () => {
  org = await createTestOrganization('Restricted Org');
  owner = await person('owner', 'owner');
  alice = await person('alice', 'editor');
  bob = await person('bob', 'editor');
  carol = await person('carol', 'editor');
  reader = await person('reader', 'viewer');
  [{ id: secret }] = await privilegedDb.insert(projects).values({ name: 'Secret', userId: owner.id, organizationId: org }).returning();
  await as(owner)
    .put(`/api/projects/${secret}/access`)
    .send({
      restricted: true,
      members: [
        { userId: alice.id, role: 'editor' },
        { userId: bob.id, role: 'viewer' },
        { userId: reader.id, role: 'editor' },
      ],
    })
    .expect(200);
});

describe('effectiveProjectRole', () => {
  it('narrows the organization role on a restricted project, and never widens it', () => {
    expect(effectiveProjectRole('owner', true, null)).toBe('owner');
    expect(effectiveProjectRole('editor', false, null)).toBe('editor');
    expect(effectiveProjectRole('editor', true, 'viewer')).toBe('viewer');
    expect(effectiveProjectRole('viewer', true, 'editor')).toBe('viewer');
    expect(effectiveProjectRole('editor', true, null)).toBeNull();
  });
});

describe('the project list', () => {
  it('says what each member may do, and leaves out what they may not see', async () => {
    const accessOf = async (who: Person) => {
      const list = await as(who).get('/api/projects').expect(200);
      return list.body.find((p: { id: number }) => p.id === secret)?.access ?? null;
    };
    expect(await accessOf(owner)).toBe('owner');
    expect(await accessOf(alice)).toBe('editor');
    expect(await accessOf(bob)).toBe('viewer');
    expect(await accessOf(reader)).toBe('viewer');
    expect(await accessOf(carol)).toBeNull();
  });
});

describe('changing who is on a project', () => {
  it('is for owners', async () => {
    await as(alice).put(`/api/projects/${secret}/access`).send({ restricted: false, members: [] }).expect(403);
    await as(alice).get(`/api/projects/${secret}/access`).expect(403);
  });

  it("accepts only people of the owner's own organization", async () => {
    const elsewhere = await createTestOrganization('Elsewhere');
    const stranger = await person('stranger', 'editor', elsewhere);
    await as(owner).put(`/api/projects/${secret}/access`).send({ restricted: true, members: [{ userId: stranger.id, role: 'editor' }] }).expect(400);

    await privilegedDb.update(users).set({ kind: 'service' }).where(eq(users.id, carol.id));
    await as(owner).put(`/api/projects/${secret}/access`).send({ restricted: true, members: [{ userId: carol.id, role: 'editor' }] }).expect(400);
  });

  it('records the change, with who is on it now', async () => {
    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'project.access_changed'));
    const mine = entries.find((e) => e.organizationId === org)!;
    expect(mine.metadata).toMatchObject({ name: 'Secret', from: 'open', to: 'restricted' });
    expect((mine.metadata as { members: unknown[] }).members).toHaveLength(3);
  });

  it('opens it again, keeping the list', async () => {
    const opened = await as(owner).put(`/api/projects/${secret}/access`).send({ restricted: false, members: [{ userId: alice.id, role: 'editor' }] }).expect(200);
    expect(opened.body).toMatchObject({ restricted: false, members: [expect.objectContaining({ userId: alice.id })] });

    const list = await as(carol).get('/api/projects').expect(200);
    expect(list.body.find((p: { id: number }) => p.id === secret)?.access).toBe('editor');
  });
});

describe('a test in a restricted project', () => {
  it('is read-only to a viewer on it, missing to someone not on it, and editable to an editor on it', async () => {
    const [row] = await privilegedDb
      .insert(tests)
      .values({ name: `Checkout-${Math.random()}`, url: 'https://x.test', sequence: [], elements: [], userId: owner.id, organizationId: org, projectId: secret } as any)
      .returning();

    const readOnly = await as(bob).put(`/api/tests/${row.id}`).send({ url: 'https://y.test' }).expect(403);
    expect(readOnly.body.code).toBe('project_read_only');
    await as(bob).delete(`/api/tests/${row.id}`).expect(403);

    await as(carol).put(`/api/tests/${row.id}`).send({ url: 'https://y.test' }).expect(404);
    const listed = await as(carol).get('/api/tests').expect(200);
    expect(listed.body.map((t: { id: number }) => t.id)).not.toContain(row.id);

    await as(alice).put(`/api/tests/${row.id}`).send({ url: 'https://y.test' }).expect(200);
  });

  it('cannot be created there by someone who cannot reach it, and the answer does not say it exists', async () => {
    const hidden = await as(carol)
      .post('/api/tests')
      .send({ name: `Sneaky-${Math.random()}`, url: 'https://x.test', sequence: [], elements: [], projectId: secret })
      .expect(400);
    const missing = await as(carol)
      .post('/api/tests')
      .send({ name: `Nowhere-${Math.random()}`, url: 'https://x.test', sequence: [], elements: [], projectId: 999999 })
      .expect(400);
    expect(hidden.body).toEqual(missing.body);
  });
});
