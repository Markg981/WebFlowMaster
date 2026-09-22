import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import { projectElements, projects } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

const proposeTestSteps = vi.fn();
const isAvailable = vi.fn();

vi.mock('../ai-automation-service', () => ({
  aiService: {
    isAvailable: () => isAvailable(),
    proposeTestSteps: (prompt: string) => proposeTestSteps(prompt),
  },
}));

/**
 * A test written by describing it.
 *
 * The route reads sentences and answers with steps; it saves nothing. What these hold is that
 * the catalogue a sentence may be about is this organization's and no one else's, that a
 * viewer cannot author, and that a line nobody could read comes back named rather than
 * missing — a sentence that disappears is how a test ends up asserting less than its author
 * believes it does.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let projectId: number;
let otherOrganizationId: number;
let otherUserId: number;
let otherProjectId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const detected = [
  { id: 'd1', type: 'button', selector: '#save', tag: 'button', text: 'Save', attributes: {} },
  { id: 'd2', type: 'input', selector: '#user', tag: 'input', text: '', attributes: { placeholder: 'Username' } },
];

beforeAll(async () => {
  organizationId = await createTestOrganization('Authoring Org');
  userId = await createTestUser(organizationId, 'authoring-user');
  otherOrganizationId = await createTestOrganization('Other Authoring Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-authoring-user');

  const [project] = await privilegedDb.insert(projects).values({ name: 'App', userId, organizationId }).returning();
  projectId = project.id;
  const [otherProject] = await privilegedDb
    .insert(projects)
    .values({ name: 'Their App', userId: otherUserId, organizationId: otherOrganizationId })
    .returning();
  otherProjectId = otherProject.id;

  const { default: nlAuthoringRoutes } = await import('./nl-authoring.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(nlAuthoringRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(projectElements);
  currentUser = { id: userId, username: 'authoring-user', organizationId, role: 'editor' };
  proposeTestSteps.mockReset();
  isAvailable.mockReturnValue(false);
});

async function keepElement(
  targetProjectId: number,
  targetOrganizationId: number,
  overrides: Record<string, unknown> = {},
) {
  const [row] = await privilegedDb
    .insert(projectElements)
    .values({
      id: uuidv4(),
      organizationId: targetOrganizationId,
      projectId: targetProjectId,
      name: 'Publish button',
      selector: '#publish',
      tag: 'button',
      ...overrides,
    })
    .returning();
  return row;
}

describe('POST /api/authoring/steps', () => {
  it('answers a description with the steps that perform it', async () => {
    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Go to https://example.test\nClick the Save button', elements: detected })
      .expect(200);

    expect(response.body.steps.map((item: any) => item.step.action.id)).toEqual(['navigate', 'click']);
    expect(response.body.steps[1].step.targetElement.selector).toBe('#save');
    expect(response.body.unresolved).toEqual([]);
  });

  it('saves nothing — the author decides what to keep', async () => {
    await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Save button', elements: detected })
      .expect(200);

    expect(await privilegedDb.select().from(projectElements)).toHaveLength(0);
  });

  it('lets a sentence name an element the project already owns', async () => {
    const element = await keepElement(projectId, organizationId);

    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Publish button', projectId })
      .expect(200);

    // And the step points at the repository, so the next repair reaches this test too.
    expect(response.body.steps[0].step.targetElement.elementId).toBe(element.id);
  });

  it('cannot be pointed at another organization’s project', async () => {
    await keepElement(otherProjectId, otherOrganizationId);

    await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Publish button', projectId: otherProjectId })
      .expect(404);
  });

  it('reports the line it could not read instead of dropping it', async () => {
    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Save button\nDo the needful', elements: detected })
      .expect(200);

    expect(response.body.steps).toHaveLength(1);
    expect(response.body.unresolved).toEqual([
      expect.objectContaining({ line: 2, text: 'Do the needful' }),
    ]);
  });

  it('works with no model configured, and says so', async () => {
    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Save button', elements: detected })
      .expect(200);

    expect(proposeTestSteps).not.toHaveBeenCalled();
    expect(response.body.modelAvailable).toBe(false);
    expect(response.body.steps).toHaveLength(1);
  });

  it('asks the model about what the phrasings did not cover', async () => {
    isAvailable.mockReturnValue(true);
    proposeTestSteps.mockResolvedValue('[{"line":1,"action":"click","element":"D1"}]');

    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Put the order through', elements: detected })
      .expect(200);

    expect(proposeTestSteps).toHaveBeenCalledTimes(1);
    expect(response.body.steps[0].source).toBe('model');
    expect(response.body.steps[0].step.targetElement.selector).toBe('#save');
  });

  it('never lets the model name an element that does not exist', async () => {
    isAvailable.mockReturnValue(true);
    proposeTestSteps.mockResolvedValue('[{"line":1,"action":"click","element":"D99"}]');

    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Put the order through', elements: detected })
      .expect(200);

    expect(response.body.steps).toEqual([]);
    expect(response.body.unresolved).toHaveLength(1);
  });

  it('tells the author which names were available', async () => {
    await keepElement(projectId, organizationId);

    const response = await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Save button', projectId, elements: detected })
      .expect(200);

    expect(response.body.catalogue).toEqual({ repository: ['Publish button'], detected: 2 });
  });

  it('refuses an empty description', async () => {
    await request(app).post('/api/authoring/steps').send({ text: '   \n  ' }).expect(200);
    await request(app).post('/api/authoring/steps').send({ text: '' }).expect(400);
  });

  it('is closed to a viewer', async () => {
    currentUser = { id: userId, username: 'authoring-user', organizationId, role: 'viewer' };

    await request(app)
      .post('/api/authoring/steps')
      .send({ text: 'Click the Save button', elements: detected })
      .expect(403);
  });
});
