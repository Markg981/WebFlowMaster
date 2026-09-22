import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { privilegedDb } from '../db';
import { apiTests, projects, tags, testTags, tests as testsTable } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * What a test is for, in the organization's own words.
 *
 * A test belonged to a project and to nothing else, so every grouping a team works with — the
 * smoke set, everything that touches checkout — existed only in people's heads. These hold the
 * two things that decide whether a tag list stays usable: one name means one tag however it was
 * typed, and a tag that another organization owns is invisible rather than borrowable.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let projectId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

beforeAll(async () => {
  organizationId = await createTestOrganization('Tags Org');
  userId = await createTestUser(organizationId, 'tags-user');
  otherOrganizationId = await createTestOrganization('Other Tags Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-tags-user');

  const [project] = await privilegedDb.insert(projects).values({ name: 'Shop', userId, organizationId }).returning();
  projectId = project.id;

  const { default: tagsRoutes } = await import('./tags.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(tagsRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testTags);
  await privilegedDb.delete(tags);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(apiTests);
  currentUser = { id: userId, username: 'tags-user', organizationId, role: 'editor' };
});

async function seedTest(name = 'Checkout') {
  const [row] = await privilegedDb
    .insert(testsTable)
    .values({ name, url: 'https://shop.test', userId, organizationId, projectId, sequence: [], elements: [] })
    .returning();
  return row;
}

async function seedApiTest(name = 'Create order') {
  const [row] = await privilegedDb
    .insert(apiTests)
    .values({ name, method: 'GET', url: 'https://shop.test/api', userId, organizationId, projectId })
    .returning();
  return row;
}

async function createTag(name: string) {
  const response = await request(app).post('/api/tags').send({ name });
  return response.body;
}

describe('POST /api/tags', () => {
  it('creates a tag', async () => {
    const response = await request(app).post('/api/tags').send({ name: '  smoke  ' }).expect(201);

    expect(response.body.name).toBe('smoke');
  });

  it('answers with the existing tag when the name is already taken', async () => {
    // Two people tagging tests at the same time both mean the same "smoke". Making the second
    // one handle a conflict in order to arrive at the tag they asked for serves nothing.
    const first = await createTag('Smoke');

    const second = await request(app).post('/api/tags').send({ name: 'smoke' }).expect(200);

    expect(second.body.id).toBe(first.id);
    expect(second.body.name).toBe('Smoke');
  });

  it('refuses a nameless tag', async () => {
    await request(app).post('/api/tags').send({ name: '   ' }).expect(400);
  });

  it('is closed to a viewer', async () => {
    currentUser = { id: userId, username: 'tags-user', organizationId, role: 'viewer' };

    await request(app).post('/api/tags').send({ name: 'smoke' }).expect(403);
  });
});

describe('GET /api/tags', () => {
  it('says how much each tag is actually used', async () => {
    // A tag on nothing is either a typo or a leftover, and without the number there is no way
    // to tell it from one in daily use.
    const smoke = await createTag('smoke');
    await createTag('unused');
    const test = await seedTest();
    const apiTest = await seedApiTest();
    await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [smoke.id] }).expect(200);
    await request(app).put(`/api/api-tests/${apiTest.id}/tags`).send({ tagIds: [smoke.id] }).expect(200);

    const response = await request(app).get('/api/tags').expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({ name: 'smoke', uiCount: 1, apiCount: 1 }),
      expect.objectContaining({ name: 'unused', uiCount: 0, apiCount: 0 }),
    ]);
  });

  it('shows nothing of another organization’s tags', async () => {
    await createTag('smoke');
    currentUser = { id: otherUserId, username: 'other-tags-user', organizationId: otherOrganizationId, role: 'owner' };

    const response = await request(app).get('/api/tags').expect(200);

    expect(response.body).toEqual([]);
  });
});

describe('PUT /api/tests/:id/tags', () => {
  it('replaces the whole set, because that is what the picker sends', async () => {
    const smoke = await createTag('smoke');
    const slow = await createTag('slow');
    const test = await seedTest();

    await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [smoke.id, slow.id] }).expect(200);
    const response = await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [slow.id] }).expect(200);

    expect(response.body.tags.map((tag: any) => tag.name)).toEqual(['slow']);
    expect(await privilegedDb.select().from(testTags)).toHaveLength(1);
  });

  it('clears them when asked for none', async () => {
    const smoke = await createTag('smoke');
    const test = await seedTest();
    await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [smoke.id] }).expect(200);

    const response = await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [] }).expect(200);

    expect(response.body.tags).toEqual([]);
  });

  it('names a tag it does not have instead of applying the rest quietly', async () => {
    // RLS makes another organization's tag invisible rather than forbidden, and silently
    // dropping it would tell the author their tag was applied.
    const smoke = await createTag('smoke');
    const test = await seedTest();

    const response = await request(app)
      .put(`/api/tests/${test.id}/tags`)
      .send({ tagIds: [smoke.id, 'not-a-tag'] })
      .expect(400);

    expect(response.body.unknownTagIds).toEqual(['not-a-tag']);
    expect(await privilegedDb.select().from(testTags)).toHaveLength(0);
  });

  it('cannot tag another organization’s test', async () => {
    const test = await seedTest();
    currentUser = { id: otherUserId, username: 'other-tags-user', organizationId: otherOrganizationId, role: 'owner' };
    const theirTag = await createTag('theirs');

    await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [theirTag.id] }).expect(404);
  });
});

describe('PUT /api/tags/:id', () => {
  it('renames a tag, and every test carrying it follows', async () => {
    const smoke = await createTag('smoke');
    const test = await seedTest();
    await request(app).put(`/api/tests/${test.id}/tags`).send({ tagIds: [smoke.id] }).expect(200);

    await request(app).put(`/api/tags/${smoke.id}`).send({ name: 'smoke-suite' }).expect(200);

    const response = await request(app).get('/api/tags').expect(200);
    expect(response.body[0]).toMatchObject({ name: 'smoke-suite', uiCount: 1 });
  });

  it('refuses a rename onto a name that already exists', async () => {
    await createTag('smoke');
    const slow = await createTag('slow');

    await request(app).put(`/api/tags/${slow.id}`).send({ name: 'SMOKE' }).expect(409);
  });
});

describe('DELETE /api/tags/:id', () => {
  it('removes it from every test, and says how many', async () => {
    // Not refused while in use, unlike a step group: a tag describes tests without changing
    // what any of them does, so removing one costs a grouping and nothing else.
    const smoke = await createTag('smoke');
    const first = await seedTest('One');
    const second = await seedTest('Two');
    await request(app).put(`/api/tests/${first.id}/tags`).send({ tagIds: [smoke.id] }).expect(200);
    await request(app).put(`/api/tests/${second.id}/tags`).send({ tagIds: [smoke.id] }).expect(200);

    const response = await request(app).delete(`/api/tags/${smoke.id}`).expect(200);

    expect(response.body.removedFrom).toBe(2);
    expect(await privilegedDb.select().from(testTags)).toHaveLength(0);
    expect(await privilegedDb.select().from(tags)).toHaveLength(0);
  });

  it('cannot delete another organization’s tag', async () => {
    const smoke = await createTag('smoke');
    currentUser = { id: otherUserId, username: 'other-tags-user', organizationId: otherOrganizationId, role: 'owner' };

    await request(app).delete(`/api/tags/${smoke.id}`).expect(404);
  });
});
