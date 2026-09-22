import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import { apiKeys } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { generateApiKey } from '../api-keys';
import { apiKeyAuth, resetApiKeyUsageThrottle } from './api-key-auth';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
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
  app.get('/whoami', requireRole('viewer'), (req, res) => {
    res.json({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      apiKeyId: (req as any).apiKeyId ?? null,
    });
  });
  app.post('/editor-only', requireRole('editor'), (_req, res) => res.json({ ok: true }));
});

beforeEach(async () => {
  await privilegedDb.delete(apiKeys);
  resetApiKeyUsageThrottle();
});

describe('a request carrying a key', () => {
  it('authenticates as the user the key belongs to', async () => {
    const { id, key } = await seedKey();

    const response = await request(app).get('/whoami').set('Authorization', `Bearer ${key}`).expect(200);

    expect(response.body).toEqual({ userId, organizationId, apiKeyId: id });
  });

  it('is accepted under either header spelling', async () => {
    const { key } = await seedKey();

    await request(app).get('/whoami').set('X-API-Key', key).expect(200);
    await request(app).get('/whoami').set('Authorization', `Bearer ${key}`).expect(200);
  });

  it('carries the role of the user who created it', async () => {
    const { key } = await seedKey();

    await request(app).post('/editor-only').set('X-API-Key', key).expect(200);
  });

  it('records that the key was used', async () => {
    const { id, key } = await seedKey();

    await request(app).get('/whoami').set('X-API-Key', key).expect(200);

    await vi.waitFor(async () => {
      const [row] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));
      expect(row.lastUsedAt).not.toBeNull();
    });
  });

  it('does not write that record on every request of a burst', async () => {
    const { id, key } = await seedKey();
    await request(app).get('/whoami').set('X-API-Key', key).expect(200);
    await vi.waitFor(async () => {
      const [row] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));
      expect(row.lastUsedAt).not.toBeNull();
    });
    const [first] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));

    for (let i = 0; i < 5; i++) {
      await request(app).get('/whoami').set('X-API-Key', key).expect(200);
    }

    const [after] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(after.lastUsedAt?.getTime()).toBe(first.lastUsedAt?.getTime());
  });
});

describe('a request whose key cannot be used', () => {
  it('is refused as unauthenticated when the key is unknown', async () => {
    await request(app).get('/whoami').set('X-API-Key', 'wfm_not-a-real-key').expect(401);
  });

  it('is refused when the key was revoked', async () => {
    const { key } = await seedKey({ revokedAt: new Date() });

    await request(app).get('/whoami').set('X-API-Key', key).expect(401);
  });

  it('is refused when the key has expired', async () => {
    const { key } = await seedKey({ expiresAt: new Date(Date.now() - 1000) });

    await request(app).get('/whoami').set('X-API-Key', key).expect(401);
  });

  it('answers a revoked key exactly as it answers no key at all', async () => {
    const { key } = await seedKey({ revokedAt: new Date() });

    const revoked = await request(app).get('/whoami').set('X-API-Key', key);
    const none = await request(app).get('/whoami');

    expect(revoked.status).toBe(none.status);
    expect(revoked.body).toEqual(none.body);
  });

  it("leaves a Bearer token that is not ours alone", async () => {
    await request(app).get('/whoami').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.jwt').expect(401);
  });
});

describe('a session', () => {
  it('wins over a key pasted into a header, rather than being silently replaced', async () => {
    const { key } = await seedKey();
    const sessionApp = express();
    sessionApp.use((req, _res, next) => {
      (req as any).user = { id: 999, organizationId: 4242, role: 'viewer', username: 'session-user' };
      (req as any).isAuthenticated = () => true;
      next();
    });
    sessionApp.use(apiKeyAuth);
    sessionApp.get('/whoami', (req, res) => res.json({ userId: req.user!.id }));

    const response = await request(sessionApp).get('/whoami').set('X-API-Key', key).expect(200);

    expect(response.body.userId).toBe(999);
  });
});
