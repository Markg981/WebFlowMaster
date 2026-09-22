import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import { projectElements, projects, tests as testsTable } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * One definition of an element, per application, instead of one copy per test that touches it.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let projectId: number;
let otherOrganizationId: number;
let otherUserId: number;
let otherProjectId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const element = (overrides: Record<string, unknown> = {}) => ({
  name: 'Save button',
  selector: '#save',
  tag: 'button',
  text: 'Save',
  ...overrides,
});

beforeAll(async () => {
  organizationId = await createTestOrganization('Elements Route Org');
  userId = await createTestUser(organizationId, 'elements-route-user');
  otherOrganizationId = await createTestOrganization('Other Elements Route Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-elements-route-user');

  const [project] = await privilegedDb.insert(projects).values({ name: 'App', userId, organizationId }).returning();
  projectId = project.id;
  const [otherProject] = await privilegedDb
    .insert(projects)
    .values({ name: 'Other App', userId: otherUserId, organizationId: otherOrganizationId })
    .returning();
  otherProjectId = otherProject.id;

  const { default: projectElementsRoutes } = await import('./project-elements.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(projectElementsRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(projectElements);
  currentUser = { id: userId, username: 'elements-route-user', organizationId, role: 'editor' };
});

async function seedTestUsing(elementId: string, name = 'Checkout') {
  await privilegedDb.insert(testsTable).values({
    userId,
    organizationId,
    name,
    url: 'https://example.test',
    sequence: [
      {
        id: uuidv4(),
        action: { id: 'click', type: 'click', name: 'Click', icon: 'MousePointer', description: 'Click' },
        targetElement: { id: 'el', type: 'button', selector: '#save', tag: 'button', attributes: {}, elementId },
      },
    ],
    elements: [],
  });
}

describe('POST /api/projects/:projectId/elements', () => {
  it('keeps an element for the project, remembering what its selector was', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);

    expect(response.body.projectId).toBe(projectId);
    expect(response.body.selector).toBe('#save');
    expect(response.body.originalSelector).toBe('#save');
  });

  it('refuses a second element with the same name in one project', async () => {
    await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);

    const response = await request(app).post(`/api/projects/${projectId}/elements`).send(element({ selector: '#other' })).expect(409);

    expect(response.body.error).toContain('Save button');
  });

  it('lets two projects each have their own "Save button"', async () => {
    await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);
    currentUser = { id: otherUserId, username: 'other-elements-route-user', organizationId: otherOrganizationId, role: 'editor' };

    await request(app).post(`/api/projects/${otherProjectId}/elements`).send(element()).expect(201);
  });

  it("cannot write into another organization's project", async () => {
    await request(app).post(`/api/projects/${otherProjectId}/elements`).send(element()).expect(404);

    expect(await privilegedDb.select().from(projectElements)).toHaveLength(0);
  });

  it('refuses a viewer', async () => {
    currentUser = { ...currentUser, role: 'viewer' };

    await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(403);
  });
});

describe('GET /api/projects/:projectId/elements', () => {
  it("lists one project's elements and not another's", async () => {
    await request(app).post(`/api/projects/${projectId}/elements`).send(element({ name: 'Ours' })).expect(201);
    currentUser = { id: otherUserId, username: 'other-elements-route-user', organizationId: otherOrganizationId, role: 'editor' };
    await request(app).post(`/api/projects/${otherProjectId}/elements`).send(element({ name: 'Theirs' })).expect(201);

    const theirs = await request(app).get(`/api/projects/${otherProjectId}/elements`).expect(200);
    currentUser = { id: userId, username: 'elements-route-user', organizationId, role: 'editor' };
    const ours = await request(app).get(`/api/projects/${projectId}/elements`).expect(200);

    expect(theirs.body.map((e: any) => e.name)).toEqual(['Theirs']);
    expect(ours.body.map((e: any) => e.name)).toEqual(['Ours']);
  });
});

describe('PUT /api/project-elements/:id', () => {
  it('corrects a selector once, for every test that names it', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);

    const response = await request(app)
      .put(`/api/project-elements/${created.body.id}`)
      .send({ selector: '#save-v2' })
      .expect(200);

    expect(response.body.selector).toBe('#save-v2');
    // What it used to be survives the correction.
    expect(response.body.originalSelector).toBe('#save');
  });

  it("cannot reach another organization's element", async () => {
    const created = await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);
    currentUser = { id: otherUserId, username: 'other-elements-route-user', organizationId: otherOrganizationId, role: 'editor' };

    await request(app).put(`/api/project-elements/${created.body.id}`).send({ selector: '#hijacked' }).expect(404);
  });
});

describe('DELETE /api/project-elements/:id', () => {
  it('refuses while tests still name it, and says which', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);
    await seedTestUsing(created.body.id, 'Checkout');

    const response = await request(app).delete(`/api/project-elements/${created.body.id}`).expect(409);

    expect(response.body.tests).toEqual(['Checkout']);
    expect(await privilegedDb.select().from(projectElements)).toHaveLength(1);
  });

  it('deletes one nothing names', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);

    await request(app).delete(`/api/project-elements/${created.body.id}`).expect(200);

    expect(await privilegedDb.select().from(projectElements)).toHaveLength(0);
  });
});

describe('GET /api/project-elements/:id/usage', () => {
  it('names the tests that would change if this element did', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/elements`).send(element()).expect(201);
    await seedTestUsing(created.body.id, 'Checkout');
    await seedTestUsing(created.body.id, 'Profile');

    const response = await request(app).get(`/api/project-elements/${created.body.id}/usage`).expect(200);

    expect(response.body.map((t: any) => t.name).sort()).toEqual(['Checkout', 'Profile']);
  });
});
