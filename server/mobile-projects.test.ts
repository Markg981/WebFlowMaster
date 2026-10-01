import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { browserGrids, mobileTestRuns, mobileTests, projectMembers, projects } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * A mobile app test's project (migration 0057): chosen when it is written, and in a restricted
 * project the test — and its runs, which show its app's screens — is its members' only. A viewer
 * on the project sees it and cannot change, run or delete it.
 */

type User = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let organizationId: number;
let owner: User;
let member: User;
let reader: User;
let outsider: User;
let currentUser: User;
let secretProject: number;
let openProject: number;

const SHOP = { platform: 'android', app: 'bs://a', deviceName: 'Google Pixel 8', steps: [{ id: 's', action: 'tap', target: '~login' }] };

beforeAll(async () => {
  organizationId = await createTestOrganization('Mobile Projects Org');
  const user = async (name: string, role: string): Promise<User> => ({ id: await createTestUser(organizationId, name), username: name, organizationId, role });
  owner = await user('mproj-owner', 'owner');
  member = await user('mproj-member', 'editor');
  reader = await user('mproj-reader', 'editor');
  outsider = await user('mproj-outsider', 'editor');
  [{ id: secretProject }] = await privilegedDb.insert(projects).values({ name: `Secret ${Date.now()}`, userId: owner.id, organizationId, restricted: true } as any).returning();
  [{ id: openProject }] = await privilegedDb.insert(projects).values({ name: `Open ${Date.now()}`, userId: owner.id, organizationId } as any).returning();
  await privilegedDb.insert(projectMembers).values([
    { projectId: secretProject, userId: member.id, organizationId, role: 'editor' },
    { projectId: secretProject, userId: reader.id, organizationId, role: 'viewer' },
  ] as any);

  const { default: routes, mobileRunner } = await import('./routes/mobile-tests.routes');
  mobileRunner.start = async () => {};
  const { runWithTenant } = await import('./middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(routes);
});

beforeEach(() => {
  currentUser = member;
});

describe('a mobile test in a restricted project', () => {
  it('is written by a member, and seen, changed and run only by those who may', async () => {
    const created = await request(app).post('/api/mobile-tests').send({ ...SHOP, name: `Secret checkout ${uuidv4().slice(0, 6)}`, projectId: secretProject });
    expect(created.status).toBe(201);
    expect(created.body.projectId).toBe(secretProject);
    const id = created.body.id;
    const gridId = uuidv4();
    await privilegedDb.insert(browserGrids).values({ id: gridId, organizationId, name: `BS ${gridId.slice(0, 6)}`, provider: 'browserstack', username: 'u' });

    // Somebody outside the project does not know it exists — nor its runs.
    expect((await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId })).status).toBe(202);
    currentUser = outsider;
    expect((await request(app).get('/api/mobile-tests')).body.some((t: any) => t.id === id)).toBe(false);
    expect((await request(app).get(`/api/mobile-tests/${id}`)).status).toBe(404);
    const [run] = await privilegedDb.select().from(mobileTestRuns).where(eq(mobileTestRuns.mobileTestId, id));
    expect((await request(app).get(`/api/mobile-test-runs/${run.id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/mobile-tests/${id}`)).status).toBe(404);

    // A viewer on the project sees it, and is told why they cannot change it.
    currentUser = reader;
    expect((await request(app).get(`/api/mobile-tests/${id}`)).status).toBe(200);
    for (const response of [
      await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, name: 'Renamed', projectId: secretProject }),
      await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId }),
      await request(app).delete(`/api/mobile-tests/${id}`),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/view this test's project but not change it/);
    }
    // Nor can they move a test of theirs into it.
    const theirs = await request(app).post('/api/mobile-tests').send({ ...SHOP, name: `Reader's ${uuidv4().slice(0, 6)}`, projectId: secretProject });
    expect(theirs.status).toBe(400);

    // The member moves it to an open project, where everybody sees it.
    currentUser = member;
    expect((await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, name: created.body.name, projectId: openProject })).body.projectId).toBe(openProject);
    currentUser = outsider;
    expect((await request(app).get(`/api/mobile-tests/${id}`)).status).toBe(200);
  });

  it('refuses a project of another organization', async () => {
    const other = await createTestOrganization('Other Mobile Projects Org');
    const [{ id: foreign }] = await privilegedDb.insert(projects).values({ name: `Theirs ${Date.now()}`, userId: owner.id, organizationId: other } as any).returning();
    const res = await request(app).post('/api/mobile-tests').send({ ...SHOP, name: `Foreign ${uuidv4().slice(0, 6)}`, projectId: foreign });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid project ID or project does not exist.');
    expect(await privilegedDb.select().from(mobileTests).where(eq(mobileTests.projectId, foreign))).toEqual([]);
  });
});
