import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../../platform/db';
import { apiKeys, organizationMemberships } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../../tests/factories';
import { generateApiKey } from '../../identity/api-keys';
import { joinOrganization, switchOrganization } from '../../tenancy/organization-memberships';
import { apiKeyAuth, resetApiKeyUsageThrottle } from './api-key-auth';

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
 * Authenticating as a pipeline rather than as a person.
 *
 * The contract is narrow on purpose: this puts a user on the request and nothing else, so
 * `tenancyMiddleware`, `requireRole` and every handler keep exactly one notion of who is
 * calling. An unusable key leaves the request as unauthenticated as it arrived, so a revoked
 * key and no key at all look the same from outside.
 */

let app: express.Express;
let organizationId: number;
let userId: number;

async function seedKey(overrides: Partial<typeof apiKeys.$inferInsert> = {}) {
  const { key, hashedKey, prefix } = generateApiKey();
  const id = uuidv4();
  await privilegedDb.insert(apiKeys).values({
    id,
    organizationId,
    userId,
    name: 'CI',
    scopes: ['projects:read'],
    prefix,
    hashedKey,
    ...overrides,
  });
  return { id, key };
}

beforeAll(async () => {
  organizationId = await createTestOrganization('Key Auth Org');
  userId = await createTestUser(organizationId, 'key-auth-user');

  const { requireRole } = await import('./require-role');

  app = express();
  app.use(express.json());
  // No passport here: an unauthenticated request is simply one with no user, which is what
  // the middleware sees in production before a session has been established.
  app.use((req, _res, next) => {
    (req as any).isAuthenticated = () => !!(req as any).user;
    next();
  });
  app.use(apiKeyAuth);
  app.get('/api/v1/whoami', requireRole('viewer'), (req, res) => {
    res.json({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      apiKeyId: (req as any).apiKeyId ?? null,
    });
  });
  app.post('/api/v1/editor-only', requireRole('editor'), (_req, res) => res.json({ ok: true }));
});

beforeEach(async () => {
  await privilegedDb.delete(apiKeys);
  resetApiKeyUsageThrottle();
});

describe('a request carrying a key', () => {
  it('authenticates as the user the key belongs to', async () => {
    const { id, key } = await seedKey();

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', `Bearer ${key}`)
      .expect(200);

    expect(response.body).toEqual({ userId, organizationId, apiKeyId: id });
  });

  it('is accepted under either header spelling', async () => {
    const { key } = await seedKey();

    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(200);
    await request(app).get('/api/v1/whoami').set('Authorization', `Bearer ${key}`).expect(200);
  });

  it('carries the role of the user who created it', async () => {
    const { key } = await seedKey();

    await request(app).post('/api/v1/editor-only').set('X-API-Key', key).expect(200);
  });

  it('acts in the organization that issued it, with the role held there, wherever its user switched', async () => {
    const issuer = await createTestOrganization('Key Home Org');
    const other = await createTestOrganization('Key Other Org');
    const traveller = await createTestUser(issuer, 'key-traveller');
    await privilegedDb.transaction((tx) => joinOrganization(tx, traveller, other, 'editor'));
    await privilegedDb
      .update(organizationMemberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(organizationMemberships.userId, traveller),
          eq(organizationMemberships.organizationId, issuer),
        ),
      );
    const { key } = await seedKey({ organizationId: issuer, userId: traveller });

    // The person moves their sign-in to the other organization, where they are an editor.
    await switchOrganization(traveller, other);

    const response = await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(200);
    expect(response.body.organizationId).toBe(issuer);
    // Still the viewer it is in the issuing organization, not the editor it is elsewhere.
    await request(app).post('/api/v1/editor-only').set('X-API-Key', key).expect(403);
  });

  it('records that the key was used', async () => {
    const { id, key } = await seedKey();

    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(200);

    await vi.waitFor(async () => {
      const [row] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));
      expect(row.lastUsedAt).not.toBeNull();
    });
  });

  it('does not write that record on every request of a burst', async () => {
    const { id, key } = await seedKey();
    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(200);
    await vi.waitFor(async () => {
      const [row] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));
      expect(row.lastUsedAt).not.toBeNull();
    });
    const [first] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));

    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(200);
    }

    const [after] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(after.lastUsedAt?.getTime()).toBe(first.lastUsedAt?.getTime());
  });
});

describe('a request whose key cannot be used', () => {
  it('is refused as unauthenticated when the key is unknown', async () => {
    await request(app).get('/api/v1/whoami').set('X-API-Key', 'wfm_not-a-real-key').expect(401);
  });

  it('is refused when the key has no scopes (audit C-03)', async () => {
    const { key } = await seedKey({ scopes: null });

    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(401);
  });

  it('is refused when the key was revoked', async () => {
    const { key } = await seedKey({ revokedAt: new Date() });

    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(401);
  });

  it('is refused when the key has expired', async () => {
    const { key } = await seedKey({ expiresAt: new Date(Date.now() - 1000) });

    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(401);
  });

  it('answers a revoked key exactly as it answers no key at all', async () => {
    const { key } = await seedKey({ revokedAt: new Date() });

    const revoked = await request(app).get('/api/v1/whoami').set('X-API-Key', key);
    const none = await request(app).get('/api/v1/whoami');

    expect(revoked.status).toBe(none.status);
    expect(revoked.body).toEqual(none.body);
  });

  it('is refused once its user is no longer a member of the organization that issued it', async () => {
    const issuer = await createTestOrganization('Key Issuer Org');
    const elsewhere = await createTestOrganization('Key Elsewhere Org');
    const leaver = await createTestUser(issuer, 'key-leaver');
    await privilegedDb.transaction((tx) => joinOrganization(tx, leaver, elsewhere, 'editor'));
    await switchOrganization(leaver, elsewhere);
    const { key } = await seedKey({ organizationId: issuer, userId: leaver });
    await privilegedDb
      .delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, leaver),
          eq(organizationMemberships.organizationId, issuer),
        ),
      );

    await request(app).get('/api/v1/whoami').set('X-API-Key', key).expect(401);
  });

  it('leaves a Bearer token that is not ours alone', async () => {
    await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.jwt')
      .expect(401);
  });
});

describe('a session', () => {
  it('wins over a key pasted into a header, rather than being silently replaced', async () => {
    const { key } = await seedKey();
    const sessionApp = express();
    sessionApp.use((req, _res, next) => {
      (req as any).user = {
        id: 999,
        organizationId: 4242,
        role: 'viewer',
        username: 'session-user',
      };
      (req as any).isAuthenticated = () => true;
      next();
    });
    sessionApp.use(apiKeyAuth);
    sessionApp.get('/whoami', (req, res) => res.json({ userId: req.user!.id }));

    const response = await request(sessionApp).get('/whoami').set('X-API-Key', key).expect(200);

    expect(response.body.userId).toBe(999);
  });

  it("gives way to a key on /api/v1, the key's own API", async () => {
    // A member whose session must still set up a second factor: the key they made before the
    // policy keeps working for the pipeline, even when called from that browser.
    const { id, key } = await seedKey();
    const sessionApp = express();
    sessionApp.use((req, _res, next) => {
      (req as any).user = {
        id: 999,
        organizationId: 4242,
        role: 'viewer',
        username: 'session-user',
      };
      (req as any).isAuthenticated = () => true;
      next();
    });
    sessionApp.use(apiKeyAuth);
    sessionApp.get('/api/v1/whoami', (req, res) =>
      res.json({ userId: req.user!.id, apiKeyId: (req as any).apiKeyId }),
    );

    const response = await request(sessionApp)
      .get('/api/v1/whoami')
      .set('X-API-Key', key)
      .expect(200);

    expect(response.body).toEqual({ userId, apiKeyId: id });
  });
});
