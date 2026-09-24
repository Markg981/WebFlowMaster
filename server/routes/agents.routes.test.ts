import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { agents, auditLog } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { hashAgentToken } from '../agents/agent-credentials';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * Creating and revoking local agents. What is worth a test: the token exists in one response and
 * then only as a hash, only an owner makes or revokes one, an organization sees only its own, a
 * revoked agent is dropped from the relay at once and can no longer authenticate.
 */

const { authenticateAgentToken } = await import('../agents/agent-auth');
const { setAgentRelay } = await import('../agents/relay');

let app: express.Express;
let organizationId: number;
let ownerId: number;
let otherOrganizationId: number;
let otherOwnerId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };
const relay = { isConnected: vi.fn(() => true), sessionsOf: vi.fn(() => 1), disconnect: vi.fn() };

beforeAll(async () => {
  organizationId = await createTestOrganization('Agents Org');
  ownerId = await createTestUser(organizationId, 'agents-owner');
  otherOrganizationId = await createTestOrganization('Other Agents Org');
  otherOwnerId = await createTestUser(otherOrganizationId, 'other-agents-owner');

  const { default: agentsRoutes } = await import('./agents.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(agentsRoutes);
  setAgentRelay(relay as any);
});

afterAll(() => setAgentRelay(null));

beforeEach(async () => {
  await privilegedDb.delete(agents);
  await privilegedDb.delete(auditLog);
  relay.disconnect.mockClear();
  currentUser = { id: ownerId, username: 'agents-owner', organizationId, role: 'owner' };
});

describe('POST /api/agents', () => {
  it('returns the token once, stores only its hash, and the token authenticates the agent', async () => {
    const response = await request(app).post('/api/agents').send({ name: 'Build box', pool: 'OnPrem' }).expect(201);

    expect(response.body.token).toMatch(/^wfa_/);
    expect(response.body.agent).toMatchObject({ name: 'Build box', pool: 'onprem', connected: true, activeSessions: 1 });
    expect(response.body.agent.tokenHash).toBeUndefined();

    const [stored] = await privilegedDb.select().from(agents).where(eq(agents.id, response.body.agent.id));
    expect(stored.tokenHash).toBe(hashAgentToken(response.body.token));
    expect(stored.organizationId).toBe(organizationId);
    expect(JSON.stringify(stored)).not.toContain(response.body.token);

    expect(await authenticateAgentToken(response.body.token)).toMatchObject({ id: stored.id, organizationId, pool: 'onprem' });
    expect(await authenticateAgentToken('wfa_not-a-token')).toBeNull();

    const listing = await request(app).get('/api/agents').expect(200);
    expect(JSON.stringify(listing.body)).not.toContain(response.body.token);
    expect(listing.body.serverPlaywrightVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('puts an agent in the default pool when none is named, and refuses a pool name that is not one', async () => {
    const created = await request(app).post('/api/agents').send({ name: 'Laptop' }).expect(201);
    expect(created.body.agent.pool).toBe('default');
    await request(app).post('/api/agents').send({ name: 'Bad', pool: 'has spaces' }).expect(400);
    await request(app).post('/api/agents').send({ name: '  ' }).expect(400);
  });

  it('records the creation with the prefix and never the token', async () => {
    const created = await request(app).post('/api/agents').send({ name: 'Audited', pool: 'lab' }).expect(201);
    const entries = await privilegedDb.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'agent.created', targetType: 'agent', targetId: created.body.agent.id });
    expect(JSON.stringify(entries[0].metadata)).not.toContain(created.body.token);
  });

  it('is for owners only', async () => {
    currentUser = { ...currentUser, role: 'admin' };
    await request(app).post('/api/agents').send({ name: 'Nope' }).expect(403);
  });
});

describe('GET /api/agents', () => {
  it("shows this organization's agents and not another's, to a viewer too", async () => {
    await request(app).post('/api/agents').send({ name: 'Ours' }).expect(201);
    currentUser = { id: otherOwnerId, username: 'other-agents-owner', organizationId: otherOrganizationId, role: 'owner' };
    await request(app).post('/api/agents').send({ name: 'Theirs' }).expect(201);

    currentUser = { id: ownerId, username: 'agents-owner', organizationId, role: 'viewer' };
    const listing = await request(app).get('/api/agents').expect(200);
    expect(listing.body.agents.map((a: { name: string }) => a.name)).toEqual(['Ours']);
  });
});

describe('POST /api/agents/:id/revoke', () => {
  it('revokes, drops the connection, stops the token working, and records it', async () => {
    const created = await request(app).post('/api/agents').send({ name: 'Old', pool: 'lab' }).expect(201);
    const id = created.body.agent.id;

    const revoked = await request(app).post(`/api/agents/${id}/revoke`).expect(200);
    expect(revoked.body.revokedAt).not.toBeNull();
    expect(revoked.body.connected).toBe(false);
    expect(relay.disconnect).toHaveBeenCalledWith(id, 'This agent was revoked.');
    expect(await authenticateAgentToken(created.body.token)).toBeNull();

    const actions = (await privilegedDb.select().from(auditLog)).map((e) => e.action).sort();
    expect(actions).toEqual(['agent.created', 'agent.revoked']);

    await request(app).post(`/api/agents/${id}/revoke`).expect(404);
  });

  it("cannot reach another organization's agent", async () => {
    currentUser = { id: otherOwnerId, username: 'other-agents-owner', organizationId: otherOrganizationId, role: 'owner' };
    const theirs = await request(app).post('/api/agents').send({ name: 'Theirs' }).expect(201);

    currentUser = { id: ownerId, username: 'agents-owner', organizationId, role: 'owner' };
    await request(app).post(`/api/agents/${theirs.body.agent.id}/revoke`).expect(404);
    expect(relay.disconnect).not.toHaveBeenCalled();
  });

  it('is for owners only', async () => {
    const created = await request(app).post('/api/agents').send({ name: 'Kept' }).expect(201);
    currentUser = { ...currentUser, role: 'editor' };
    await request(app).post(`/api/agents/${created.body.agent.id}/revoke`).expect(403);
  });
});
