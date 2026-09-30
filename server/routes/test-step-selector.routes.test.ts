import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { auditLog, tests, testVersions } from '@shared/schema';
import { stepsWithArtifactUrls } from './artifacts.routes';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Putting a selector the AI proposed back into the step it was proposed for: one step of the
 * test's own, saved as a new version like any save, and traceable from the report because each
 * step result now carries the step's id.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };
let testId: number;

const sequence = [
  { id: 'open', action: { id: 'navigate', name: 'Open' }, value: 'https://shop.test' },
  { id: 'buy', action: { id: 'click', name: 'Buy' }, targetElement: { id: 'e1', selector: 'button.buy-old', tag: 'button' } },
];

beforeAll(async () => {
  organizationId = await createTestOrganization('Selector Org');
  userId = await createTestUser(organizationId, 'selector-user');
  otherOrganizationId = await createTestOrganization('Other Selector Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-selector-user');

  const { default: routes } = await import('./tests.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(routes);
});

beforeEach(async () => {
  currentUser = { id: userId, username: 'selector-user', organizationId, role: 'editor' };
  const [row] = await privilegedDb
    .insert(tests)
    .values({ userId, organizationId, name: `Checkout ${Date.now()}`, url: 'https://shop.test', sequence, elements: [] } as any)
    .returning();
  testId = row.id;
});

const apply = (stepId: string, selector: unknown) =>
  request(app).put(`/api/tests/${testId}/steps/${stepId}/selector`).send({ selector });

describe("a step's selector", () => {
  it('is replaced in that step only, saved as a version and audited', async () => {
    const res = await apply('buy', "role=button[name='Buy']");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testId);

    const [row] = await privilegedDb.select().from(tests).where(eq(tests.id, testId));
    const saved = (typeof row.sequence === 'string' ? JSON.parse(row.sequence) : row.sequence) as typeof sequence;
    expect(saved[1].targetElement).toEqual({ id: 'e1', selector: "role=button[name='Buy']", tag: 'button' });
    expect(saved[0]).toEqual(sequence[0]);

    const versions = await privilegedDb.select().from(testVersions).where(eq(testVersions.testId, testId));
    expect(versions.length).toBeGreaterThan(0);
    const [entry] = await privilegedDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'test.updated'), eq(auditLog.targetId, String(testId))));
    expect(entry.metadata).toMatchObject({ step: 'buy', previousSelector: 'button.buy-old', selector: "role=button[name='Buy']" });
  });

  it('is refused for a step the test does not have, one with no element, or no selector', async () => {
    expect((await apply('inside-a-group', '#x')).status).toBe(404);
    expect((await apply('open', '#x')).status).toBe(409);
    expect((await apply('buy', '  ')).status).toBe(400);
  });

  it("is not another organization's to change, nor a viewer's", async () => {
    currentUser = { id: otherUserId, username: 'other', organizationId: otherOrganizationId, role: 'owner' };
    expect((await apply('buy', '#x')).status).toBe(404);
    currentUser = { id: userId, username: 'selector-user', organizationId, role: 'viewer' };
    expect((await apply('buy', '#x')).status).toBe(403);
  });
});

describe('the steps a report shows', () => {
  it("carry the test's own step id and the group call, so a fix can find its step", () => {
    const steps = stepsWithArtifactUrls('run-1', JSON.stringify([
      { name: 'Buy', type: 'click', status: 'failed', stepId: 'buy', selector: '#old' },
      { name: 'Group › Pay', type: 'click', status: 'passed', stepId: 'pay', calledFrom: 'g-call' },
      { name: 'Old result', type: 'click', status: 'passed' },
    ]));
    expect(steps.map(({ stepId, calledFrom, selector }) => ({ stepId, calledFrom, selector }))).toEqual([
      { stepId: 'buy', calledFrom: undefined, selector: '#old' },
      { stepId: 'pay', calledFrom: 'g-call', selector: null },
      { stepId: undefined, calledFrom: undefined, selector: null },
    ]);
  });
});
