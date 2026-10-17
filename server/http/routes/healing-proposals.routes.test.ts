import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { auditLog, projectMembers, projects, tests } from '@shared/schema';
import { privilegedDb } from '../../platform/db';
import { createTestOrganization, createTestUser } from '../../tests/factories';

vi.mock('../../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

/**
 * Deciding a healing proposal over HTTP (M02, P13): who may, with which fingerprint, and what a
 * repeated or out-of-date decision answers. Nothing reaches a test except through approve.
 */

let app: express.Express;
let organizationId: number;
let editorId: number;
let viewerId: number;
let projectId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const click = (id: string, selector: string) => ({
  id,
  action: { id: 'click', name: `Click ${id}` },
  targetElement: { selector },
});

beforeAll(async () => {
  organizationId = await createTestOrganization('Healing Routes Org');
  editorId = await createTestUser(organizationId, `heal-route-editor-${uuidv4().slice(0, 6)}`);
  viewerId = await createTestUser(organizationId, `heal-route-viewer-${uuidv4().slice(0, 6)}`);
  otherOrganizationId = await createTestOrganization('Other Healing Routes Org');
  otherUserId = await createTestUser(
    otherOrganizationId,
    `heal-route-other-${uuidv4().slice(0, 6)}`,
  );
  const [project] = await privilegedDb
    .insert(projects)
    .values({ name: 'Healing Routes App', userId: editorId, organizationId })
    .returning();
  projectId = project.id;

  const { default: routes } = await import('./healing-proposals.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof currentUser }).user = currentUser;
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), {
      userId: currentUser.id,
      role: currentUser.role,
    });
  });
  app.use(routes);
});

beforeEach(() => {
  currentUser = { id: editorId, username: 'heal-route-editor', organizationId, role: 'editor' };
});

/** A test with a step a run healed, and the proposal the run left. */
async function proposed(extra: Partial<typeof tests.$inferInsert> = {}) {
  const sequence = [click('t1', '#gone')];
  const [test] = await privilegedDb
    .insert(tests)
    .values({
      userId: editorId,
      organizationId,
      projectId,
      name: `Heal ${uuidv4().slice(0, 4)}`,
      url: '',
      sequence,
      elements: [],
      ...extra,
    })
    .returning();
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  const { prepareSequence } = await import('../../authoring/executable-definition');
  const { provenanceOf } = await import('../../authoring/step-provenance');
  const { recordHealingProposal } = await import('../../authoring/healing-proposals');
  const outcome = await runWithTenant(organizationId, async () => {
    const prepared = await prepareSequence(sequence);
    return recordHealingProposal({
      step: { testId: test.id, provenance: provenanceOf(prepared.steps[0]), elementId: null },
      executionId: 'exec-routes',
      attempt: null,
      stepIndex: 0,
      selector: '#second',
      origin: 'ai',
    });
  });
  expect(outcome.status).toBe('proposed');
  return { test, sequence, id: outcome.proposalId!, fingerprint: outcome.fingerprint! };
}
const testRow = async (id: number) =>
  (await privilegedDb.select().from(tests).where(eq(tests.id, id)))[0];

describe('reading proposals', () => {
  it('lists a test’s proposals to a viewer, with the fingerprint to approve against', async () => {
    const { test, id, fingerprint } = await proposed();
    currentUser = { id: viewerId, username: 'viewer', organizationId, role: 'viewer' };

    const list = await request(app).get(`/api/healing-proposals?testId=${test.id}`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id,
      fingerprint,
      status: 'proposed',
      origin: 'ai',
      selectorBefore: '#gone',
      selectorAfter: '#second',
      executionId: 'exec-routes',
      target: { kind: 'test', index: 0, stepId: 't1' },
    });
    await request(app).get(`/api/healing-proposals/${id}`).expect(200);
    await request(app).get('/api/healing-proposals?status=nonsense').expect(400);
  });

  it('shows another organization nothing', async () => {
    const { test, id } = await proposed();
    currentUser = {
      id: otherUserId,
      username: 'other',
      organizationId: otherOrganizationId,
      role: 'owner',
    };
    expect((await request(app).get(`/api/healing-proposals?testId=${test.id}`)).body).toEqual([]);
    await request(app).get(`/api/healing-proposals/${id}`).expect(404);
    await request(app).post(`/api/healing-proposals/${id}/reject`).send({}).expect(404);
  });
});

describe('approving over HTTP', () => {
  it('needs the editor role and the fingerprint, and is idempotent', async () => {
    const { test, id, fingerprint } = await proposed();

    currentUser = { id: viewerId, username: 'viewer', organizationId, role: 'viewer' };
    await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint })
      .expect(403);

    currentUser = { id: editorId, username: 'heal-route-editor', organizationId, role: 'editor' };
    await request(app).post(`/api/healing-proposals/${id}/approve`).send({}).expect(400);
    const wrong = await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint: '0'.repeat(64) })
      .expect(409);
    expect(wrong.body.code).toBe('fingerprint_mismatch');
    expect((await testRow(test.id)).sequence).toEqual([click('t1', '#gone')]);

    const ok = await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint })
      .expect(200);
    expect(ok.body).toMatchObject({
      unchanged: false,
      proposal: { status: 'approved', decidedBy: editorId },
    });
    expect((await testRow(test.id)).sequence).toEqual([click('t1', '#second')]);

    const again = await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint })
      .expect(200);
    expect(again.body.unchanged).toBe(true);
    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, id));
    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([
      ['healing_proposal.approved', editorId],
    ]);
  });

  it('answers 409 and leaves the test alone when the step changed since the run', async () => {
    const { test, id, fingerprint } = await proposed();
    const edited = [{ ...click('t1', '#gone'), value: 'edited' }];
    await privilegedDb.update(tests).set({ sequence: edited }).where(eq(tests.id, test.id));

    const stale = await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'proposal_stale', proposal: { status: 'stale' } });
    expect((await testRow(test.id)).sequence).toEqual(edited);
  });

  it('answers 403 to an editor who is only a viewer of the restricted project', async () => {
    const [restricted] = await privilegedDb
      .insert(projects)
      .values({ name: 'Locked', userId: editorId, organizationId, restricted: true })
      .returning();
    await privilegedDb
      .insert(projectMembers)
      .values({ projectId: restricted.id, userId: viewerId, organizationId, role: 'viewer' });
    const { test, id, fingerprint } = await proposed({ projectId: restricted.id });

    currentUser = { id: viewerId, username: 'viewer', organizationId, role: 'editor' };
    const refused = await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint })
      .expect(403);
    expect(refused.body.code).toBe('project_read_only');
    expect((await testRow(test.id)).sequence).toEqual([click('t1', '#gone')]);
  });
});

describe('rejecting over HTTP', () => {
  it('writes nothing, and a rejected proposal cannot be approved', async () => {
    const { test, id, fingerprint } = await proposed();
    const rejected = await request(app)
      .post(`/api/healing-proposals/${id}/reject`)
      .send({ note: 'Not this button' })
      .expect(200);
    expect(rejected.body.proposal).toMatchObject({ status: 'rejected', reason: 'Not this button' });
    const refused = await request(app)
      .post(`/api/healing-proposals/${id}/approve`)
      .send({ fingerprint })
      .expect(409);
    expect(refused.body.code).toBe('proposal_rejected');
    expect((await testRow(test.id)).sequence).toEqual([click('t1', '#gone')]);
    await request(app).post('/api/healing-proposals/not-an-id/reject').send({}).expect(404);
  });
});
