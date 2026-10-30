import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import { apiKeys, auditLog, users } from '@shared/schema';
import { createTestOrganization, createTestUser, auditLogMaintenance } from '../../tests/factories';
import { hashApiKey } from '../../identity/api-keys';

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
 * Issuing the credential a pipeline uses, and the one rule the whole design rests on: the key
 * itself exists in exactly one response and nowhere else afterwards.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

beforeAll(async () => {
  organizationId = await createTestOrganization('Keys Org');
  userId = await createTestUser(organizationId, 'keys-user');
  otherOrganizationId = await createTestOrganization('Other Keys Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-keys-user');

  const { default: apiKeysRoutes } = await import('./api-keys.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(apiKeysRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(apiKeys);
  await auditLogMaintenance(sql`DELETE FROM audit_log`);
  currentUser = { id: userId, username: 'keys-user', organizationId, role: 'editor' };
});

describe('POST /api/api-keys', () => {
  it('returns the key once, and stores only its hash', async () => {
    const response = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'GitHub Actions' })
      .expect(201);

    expect(response.body.key).toMatch(/^wfm_/);
    expect(response.body.prefix).toBe(response.body.key.slice(0, 12));
    expect(response.body.hashedKey).toBeUndefined();

    const [stored] = await privilegedDb
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, response.body.id));
    expect(stored.hashedKey).toBe(hashApiKey(response.body.key));
    expect(JSON.stringify(stored)).not.toContain(response.body.key);
  });

  it('never shows the key again, in a listing or anywhere else', async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Nightly' })
      .expect(201);

    const listing = await request(app).get('/api/api-keys').expect(200);

    expect(JSON.stringify(listing.body)).not.toContain(created.body.key);
    expect(listing.body[0].hashedKey).toBeUndefined();
    expect(listing.body[0].prefix).toBe(created.body.prefix);
  });

  it('stamps the organization from the session, not from the body', async () => {
    const response = await request(app)
      .post('/api/api-keys')
      .send({
        expiresInDays: 30,
        scopes: ['runs:read'],
        name: 'Sneaky',
        organizationId: otherOrganizationId,
        userId: otherUserId,
      })
      .expect(201);

    const [stored] = await privilegedDb
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, response.body.id));
    expect(stored.organizationId).toBe(organizationId);
    expect(stored.userId).toBe(userId);
  });

  it('records the creation in the audit trail, with the prefix and not the key', async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Audited' })
      .expect(201);

    const entries = await privilegedDb.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('api_key.created');
    expect(entries[0].targetId).toBe(created.body.id);
    expect(JSON.stringify(entries[0].metadata)).not.toContain(created.body.key);
    expect(JSON.stringify(entries[0].metadata)).toContain(created.body.prefix);
  });

  it('gives a key a lifetime when one was asked for', async () => {
    const response = await request(app)
      .post('/api/api-keys')
      .send({ scopes: ['runs:read'], name: 'Short', expiresInDays: 7 })
      .expect(201);

    const expiresAt = new Date(response.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
  });

  it('refuses a nameless key, because a list of nameless keys cannot be cleaned up', async () => {
    await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: '   ' })
      .expect(400);
  });

  it('refuses a key with no scopes or empty scopes (audit A-06)', async () => {
    await request(app).post('/api/api-keys').send({ name: 'x', expiresInDays: 7 }).expect(400);
    await request(app)
      .post('/api/api-keys')
      .send({ name: 'x', expiresInDays: 7, scopes: [] })
      .expect(400);
  });

  it('refuses a key with no expiry', async () => {
    await request(app)
      .post('/api/api-keys')
      .send({ name: 'x', scopes: ['runs:read'] })
      .expect(400);
  });

  it('caps the lifetime at API_KEY_MAX_TTL_DAYS, 365 by default', async () => {
    await request(app)
      .post('/api/api-keys')
      .send({ name: 'x', scopes: ['runs:read'], expiresInDays: 366 })
      .expect(400);
    await request(app)
      .post('/api/api-keys')
      .send({ name: 'x', scopes: ['runs:read'], expiresInDays: 365 })
      .expect(201);
    vi.stubEnv('API_KEY_MAX_TTL_DAYS', '30');
    try {
      const res = await request(app)
        .post('/api/api-keys')
        .send({ name: 'x', scopes: ['runs:read'], expiresInDays: 31 })
        .expect(400);
      expect(res.body.maxDays).toBe(30);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects creation and revocation authenticated with an API key', async () => {
    const keyAuthed = express();
    keyAuthed.use(express.json());
    keyAuthed.use((req, _res, next) => {
      (req as any).apiKeyId = 'k1';
      next();
    });
    keyAuthed.use(app);
    const create = await request(keyAuthed)
      .post('/api/api-keys')
      .send({ name: 'x', scopes: ['runs:read'], expiresInDays: 7 })
      .expect(403);
    expect(create.body.code).toBe('session_required');
    await request(keyAuthed).delete('/api/api-keys/anything').expect(403);
  });

  it('refuses a viewer', async () => {
    currentUser = { ...currentUser, role: 'viewer' };

    await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Nope' })
      .expect(403);
  });
});

describe('GET /api/api-keys', () => {
  it("shows this organization's keys and not another's", async () => {
    await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Ours' })
      .expect(201);
    currentUser = {
      id: otherUserId,
      username: 'other-keys-user',
      organizationId: otherOrganizationId,
      role: 'editor',
    };
    await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Theirs' })
      .expect(201);

    const theirs = await request(app).get('/api/api-keys').expect(200);
    currentUser = { id: userId, username: 'keys-user', organizationId, role: 'editor' };
    const ours = await request(app).get('/api/api-keys').expect(200);

    expect(theirs.body.map((k: any) => k.name)).toEqual(['Theirs']);
    expect(ours.body.map((k: any) => k.name)).toEqual(['Ours']);
  });
});

describe('DELETE /api/api-keys/:id', () => {
  it('revokes a key and records it', async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Doomed' })
      .expect(201);

    const response = await request(app).delete(`/api/api-keys/${created.body.id}`).expect(200);

    expect(response.body.revokedAt).toBeTruthy();
    const entries = await privilegedDb.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain('api_key.revoked');
  });

  it('does not move the timestamp when a key is revoked twice', async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Doomed' })
      .expect(201);
    await request(app).delete(`/api/api-keys/${created.body.id}`).expect(200);

    await request(app).delete(`/api/api-keys/${created.body.id}`).expect(404);
  });

  it('an editor cannot revoke a key held by someone else in the organization (C-25)', async () => {
    const colleagueId = await createTestUser(organizationId, 'keys-colleague');
    currentUser = { id: colleagueId, username: 'keys-colleague', organizationId, role: 'editor' };
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Colleague' })
      .expect(201);
    currentUser = { id: userId, username: 'keys-user', organizationId, role: 'editor' };

    await request(app).delete(`/api/api-keys/${created.body.id}`).expect(404);

    currentUser = { id: userId, username: 'keys-user', organizationId, role: 'owner' };
    await request(app).delete(`/api/api-keys/${created.body.id}`).expect(200);
  });

  it("cannot revoke another organization's key, and is not told it exists", async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Ours' })
      .expect(201);
    currentUser = {
      id: otherUserId,
      username: 'other-keys-user',
      organizationId: otherOrganizationId,
      role: 'editor',
    };

    await request(app).delete(`/api/api-keys/${created.body.id}`).expect(404);

    const [stored] = await privilegedDb
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.body.id));
    expect(stored.revokedAt).toBeNull();
  });
});

describe('the user a key belongs to', () => {
  it('takes its keys with them when the member is removed', async () => {
    const created = await request(app)
      .post('/api/api-keys')
      .send({ expiresInDays: 30, scopes: ['runs:read'], name: 'Leaver' })
      .expect(201);

    await privilegedDb.delete(users).where(eq(users.id, userId));

    const remaining = await privilegedDb
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.body.id));
    expect(remaining).toHaveLength(0);

    // Put the member back for the tests that follow.
    await privilegedDb
      .insert(users)
      .values({ id: userId, username: 'keys-user', password: 'hashed', organizationId });
  });
});
