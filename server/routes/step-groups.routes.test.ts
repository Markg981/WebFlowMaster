import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import { stepGroups, tests as testsTable } from '@shared/schema';
import { STEP_GROUP_ACTION_ID } from '@shared/recording';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * The named sequences a test calls instead of holding its own copy. What these rules protect
 * is the thing that makes them worth having: a group is referenced, so editing it changes
 * every test that calls it — which is also why deleting one is refused while tests still do.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const step = (id: string, name: string) => ({
  id: uuidv4(),
  action: { id, type: id, name, icon: 'MousePointer', description: name },
  targetElement: { id: 'el-1', type: 'button', selector: '#submit', tag: 'button', attributes: {} },
  value: id === 'input' ? 'someone@example.com' : undefined,
});

const loginSequence = () => [step('input', 'Type username'), step('click', 'Submit')];

beforeAll(async () => {
  organizationId = await createTestOrganization('Groups Org');
  userId = await createTestUser(organizationId, 'groups-user');
  otherOrganizationId = await createTestOrganization('Other Groups Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-groups-user');

  const { default: stepGroupsRoutes } = await import('./step-groups.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(stepGroupsRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(stepGroups);
  currentUser = { id: userId, username: 'groups-user', organizationId, role: 'editor' };
});

async function seedTestCalling(groupId: string, name = 'Checkout') {
  const [row] = await privilegedDb
    .insert(testsTable)
    .values({
      userId,
      organizationId,
      name,
      url: 'https://example.test',
      sequence: [{ id: uuidv4(), action: { id: STEP_GROUP_ACTION_ID, type: 'group', name: 'Login', icon: 'Layers', description: 'Login' }, value: groupId }],
      elements: [],
    })
    .returning();
  return row;
}

describe('POST /api/step-groups', () => {
  it('creates a group under the session organization', async () => {
    const response = await request(app)
      .post('/api/step-groups')
      .send({ name: 'Login', sequence: loginSequence() })
      .expect(201);

    expect(response.body.name).toBe('Login');
    expect(response.body.sequence).toHaveLength(2);
    const [stored] = await privilegedDb.select().from(stepGroups);
    expect(stored.organizationId).toBe(organizationId);
    expect(stored.userId).toBe(userId);
  });

  it('refuses a group that calls another group, where it is written rather than where it runs', async () => {
    const inner = await request(app).post('/api/step-groups').send({ name: 'Login', sequence: loginSequence() }).expect(201);

    await request(app)
      .post('/api/step-groups')
      .send({
        name: 'Outer',
        sequence: [{ id: uuidv4(), action: { id: STEP_GROUP_ACTION_ID, type: 'group', name: 'Login', icon: 'Layers', description: 'Login' }, value: inner.body.id }],
      })
      .expect(400);
  });

  it('refuses an empty group and a nameless one', async () => {
    await request(app).post('/api/step-groups').send({ name: 'Empty', sequence: [] }).expect(400);
    await request(app).post('/api/step-groups').send({ name: '  ', sequence: loginSequence() }).expect(400);
  });

  it('refuses a viewer', async () => {
    currentUser = { ...currentUser, role: 'viewer' };

    await request(app).post('/api/step-groups').send({ name: 'Login', sequence: loginSequence() }).expect(403);
  });
});

describe('GET /api/step-groups', () => {
  it("lists this organization's groups and not another's", async () => {
    await request(app).post('/api/step-groups').send({ name: 'Ours', sequence: loginSequence() }).expect(201);
    currentUser = { id: otherUserId, username: 'other-groups-user', organizationId: otherOrganizationId, role: 'editor' };
    await request(app).post('/api/step-groups').send({ name: 'Theirs', sequence: loginSequence() }).expect(201);

    const theirs = await request(app).get('/api/step-groups').expect(200);
    currentUser = { id: userId, username: 'groups-user', organizationId, role: 'editor' };
    const ours = await request(app).get('/api/step-groups').expect(200);

    expect(theirs.body.map((g: any) => g.name)).toEqual(['Theirs']);
    expect(ours.body.map((g: any) => g.name)).toEqual(['Ours']);
  });
});

describe('PUT /api/step-groups/:id', () => {
  it('changes the steps every calling test will run next time', async () => {
    const created = await request(app).post('/api/step-groups').send({ name: 'Login', sequence: loginSequence() }).expect(201);

    const response = await request(app)
      .put(`/api/step-groups/${created.body.id}`)
      .send({ sequence: [...loginSequence(), step('click', 'Accept cookies')] })
      .expect(200);

    expect(response.body.sequence).toHaveLength(3);
  });

  it("cannot reach another organization's group", async () => {
    const created = await request(app).post('/api/step-groups').send({ name: 'Ours', sequence: loginSequence() }).expect(201);
    currentUser = { id: otherUserId, username: 'other-groups-user', organizationId: otherOrganizationId, role: 'editor' };

    await request(app).put(`/api/step-groups/${created.body.id}`).send({ name: 'Hijacked' }).expect(404);
  });
});

describe('DELETE /api/step-groups/:id', () => {
  it('refuses while tests still call it, and names them', async () => {
    const created = await request(app).post('/api/step-groups').send({ name: 'Login', sequence: loginSequence() }).expect(201);
    await seedTestCalling(created.body.id, 'Checkout');

    const response = await request(app).delete(`/api/step-groups/${created.body.id}`).expect(409);

    expect(response.body.tests).toEqual(['Checkout']);
    expect(await privilegedDb.select().from(stepGroups)).toHaveLength(1);
  });

  it('deletes one nothing calls', async () => {
    const created = await request(app).post('/api/step-groups').send({ name: 'Unused', sequence: loginSequence() }).expect(201);

    await request(app).delete(`/api/step-groups/${created.body.id}`).expect(200);

    expect(await privilegedDb.select().from(stepGroups)).toHaveLength(0);
  });
});

describe('GET /api/step-groups/:id/usage', () => {
  it('answers the question anyone asks before editing one', async () => {
    const created = await request(app).post('/api/step-groups').send({ name: 'Login', sequence: loginSequence() }).expect(201);
    await seedTestCalling(created.body.id, 'Checkout');
    await seedTestCalling(created.body.id, 'Profile');

    const response = await request(app).get(`/api/step-groups/${created.body.id}/usage`).expect(200);

    expect(response.body.map((t: any) => t.name).sort()).toEqual(['Checkout', 'Profile']);
  });

  it('is empty for a group nothing calls', async () => {
    const created = await request(app).post('/api/step-groups').send({ name: 'Unused', sequence: loginSequence() }).expect(201);

    const response = await request(app).get(`/api/step-groups/${created.body.id}/usage`).expect(200);

    expect(response.body).toEqual([]);
  });
});
