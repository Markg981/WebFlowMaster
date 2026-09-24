import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign as rsaSign } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { auditLog, invitations, organizations, ssoIdentities, users } from '@shared/schema';

// Auth runs against the real (PGlite) test database; the identity provider is a small one started
// here, which signs its ID tokens with a key of its own. Only the logger is mocked.
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

// ─── The identity provider ──────────────────────────────────────────────────────

const CLIENT_ID = 'webflowmaster';
const CLIENT_SECRET = 'provider-secret';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64u = (value: string | Buffer) => Buffer.from(value).toString('base64url');

let provider: Server;
let issuer: string;
const issued = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown> }>();

function signToken(payload: Record<string, unknown>): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
  const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${rsaSign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

function startProvider(): Promise<void> {
  const idp = express();
  idp.use(express.urlencoded({ extended: false }));
  idp.get('/.well-known/openid-configuration', (_req, res) =>
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      code_challenge_methods_supported: ['S256'],
    }),
  );
  idp.get('/jwks', (_req, res) => res.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }));
  idp.post('/token', (req, res) => {
    const [id, secret] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64')
      .toString()
      .split(':')
      .map(decodeURIComponent);
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return res.status(401).json({ error: 'invalid_client' });
    const grant = issued.get(req.body.code);
    issued.delete(req.body.code);
    const verifier = String(req.body.code_verifier ?? '');
    if (!grant || createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const now = Math.floor(Date.now() / 1000);
    res.json({
      access_token: 'access',
      token_type: 'Bearer',
      expires_in: 300,
      id_token: signToken({ iss: issuer, aud: CLIENT_ID, iat: now, exp: now + 300, nonce: grant.nonce, ...grant.claims }),
    });
  });
  return new Promise((resolve) => {
    provider = idp.listen(0, '127.0.0.1', () => {
      issuer = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

// ─── The application ────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  await startProvider();
  const { setupAuth } = await import('./auth');
  const { tenancyMiddleware } = await import('./middleware/tenancy');
  const { requireSso } = await import('./middleware/require-sso');
  const { requireMfaEnrollment } = await import('./middleware/require-mfa-enrollment');
  const ssoRoutes = (await import('./routes/sso.routes')).default;
  app = express();
  app.use(express.json());
  setupAuth(app);
  app.use(tenancyMiddleware);
  app.use(requireSso);
  app.use(requireMfaEnrollment);
  app.use(ssoRoutes);
  // Something a signed-in member reaches, to see whether they still are.
  app.get('/api/probe', (req, res) => (req.isAuthenticated() ? res.json({ id: req.user!.id }) : res.sendStatus(401)));
});

afterAll(() => {
  provider?.close();
});

beforeEach(async () => {
  const { clearDiscoveryCache } = await import('./sso');
  clearDiscoveryCache();
  issued.clear();
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const settings = (overrides: Record<string, unknown> = {}) => ({
  issuer,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  domains: ['example.com'],
  defaultRole: 'editor',
  enabled: true,
  required: false,
  ...overrides,
});

/** The installation's first account, which owns its organization, signed in. */
async function owner(username = 'olivia@example.com') {
  const agent = request.agent(app);
  const res = await agent.post('/api/register').send({ username, password: 'password123' }).expect(201);
  return { agent, organizationId: res.body.organizationId as number, id: res.body.id as number };
}

async function member(organizationId: number, username: string, role = 'viewer') {
  const { hashPassword } = await import('./auth');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username, password: await hashPassword('password123'), organizationId, role })
    .returning();
  return user;
}

/** Signing in through the provider, as the browser would: out to it, and back with a code. */
async function ssoSignIn(email: string, claims: Record<string, unknown>, tamper?: (params: URLSearchParams) => void) {
  const browser = request.agent(app);
  const start = await browser.get('/api/sso/start').query({ email }).expect(303);
  const location = new URL(start.headers.location, 'http://app.test');
  if (!location.href.startsWith(issuer)) return { browser, back: start };

  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.get('login_hint')).toBe(email);
  const code = b64u(randomBytes(16));
  issued.set(code, { nonce: location.searchParams.get('nonce')!, challenge: location.searchParams.get('code_challenge')!, claims });
  const params = new URLSearchParams({ code, state: location.searchParams.get('state')! });
  tamper?.(params);
  const back = await browser.get(`/api/sso/callback?${params}`).expect(303);
  return { browser, back };
}

describe('setting single sign-on up', () => {
  it('saves the provider for an owner, never answers the secret, and records it', async () => {
    const { agent, organizationId } = await owner();
    const saved = await agent.put('/api/organization/sso').send(settings({ domains: ['Example.com', '@example.com'] })).expect(200);
    expect(saved.body.settings).toMatchObject({ issuer, clientId: CLIENT_ID, domains: ['example.com'], defaultRole: 'editor', enabled: true });
    expect(JSON.stringify(saved.body)).not.toContain(CLIENT_SECRET);
    expect(saved.body.callbackUrl).toMatch(/\/api\/sso\/callback$/);

    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    const configured = entries.find((e) => e.action === 'sso.configured');
    expect(configured?.metadata).toMatchObject({ domains: ['example.com'], secretChanged: true });
    expect(JSON.stringify(configured)).not.toContain(CLIENT_SECRET);

    // Changed without a secret: the stored one stays.
    await agent.put('/api/organization/sso').send(settings({ clientSecret: '', defaultRole: 'viewer' })).expect(200);
    expect((await agent.post('/api/organization/sso/test').expect(200)).body).toEqual({ ok: true, issuer });
  });

  it('refuses what cannot work: no secret, a bad issuer, a bad domain, required while off', async () => {
    const { agent } = await owner();
    expect((await agent.put('/api/organization/sso').send(settings({ clientSecret: '' })).expect(400)).body.code).toBe('secret_required');
    expect((await agent.put('/api/organization/sso').send(settings({ issuer: 'ftp://idp' })).expect(400)).body.code).toBe('invalid_issuer');
    expect((await agent.put('/api/organization/sso').send(settings({ domains: ['not a domain'] })).expect(400)).body.code).toBe('invalid_domain');
    expect((await agent.put('/api/organization/sso').send(settings({ enabled: false, required: true })).expect(400)).body.code).toBe('required_needs_enabled');
    await agent.put('/api/organization/sso').send(settings({ defaultRole: 'owner' })).expect(400);
  });

  it('gives a domain to one organization only', async () => {
    const first = await owner();
    await first.agent.put('/api/organization/sso').send(settings()).expect(200);

    const [other] = await privilegedDb.insert(organizations).values({ name: 'Other' }).returning();
    const { hashPassword } = await import('./auth');
    await privilegedDb.insert(users).values({ username: 'oscar', password: await hashPassword('password123'), organizationId: other.id, role: 'owner' });
    const second = request.agent(app);
    await second.post('/api/login').send({ username: 'oscar', password: 'password123' }).expect(200);
    const refused = await second.put('/api/organization/sso').send(settings({ domains: ['example.com', 'other.example'] })).expect(409);
    expect(refused.body.code).toBe('domain_taken');
  });

  it('is for owners', async () => {
    const { organizationId } = await owner();
    await member(organizationId, 'vic@example.com', 'editor');
    const agent = request.agent(app);
    await agent.post('/api/login').send({ username: 'vic@example.com', password: 'password123' }).expect(200);
    await agent.get('/api/organization/sso').expect(403);
    await agent.put('/api/organization/sso').send(settings()).expect(403);
  });
});

describe('signing in through the provider', () => {
  it('creates the account on the first sign-in, with the default role, and finds it after by subject', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);
    expect((await request(app).get('/api/sso/available').expect(200)).body).toEqual({ available: true });

    const { browser, back } = await ssoSignIn('Ada@Example.com', { sub: 'ada-1', email: 'Ada@Example.com', email_verified: true });
    expect(back.headers.location).toBe('/');
    const me = await browser.get('/api/user').expect(200);
    expect(me.body).toMatchObject({ username: 'ada@example.com', role: 'editor', organizationId, signedInWithSso: true });

    // A new address at the provider is the same person: the subject decides.
    const again = await ssoSignIn('ada@example.com', { sub: 'ada-1', email: 'ada.lovelace@example.com' });
    expect((await again.browser.get('/api/user').expect(200)).body.id).toBe(me.body.id);

    const actions = (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId))).map((e) => e.action);
    expect(actions.filter((a) => a === 'member.provisioned')).toHaveLength(1);
    expect(actions.filter((a) => a === 'auth.login')).toHaveLength(2);
  });

  it('links an existing member whose username is the address, and refuses one of another organization', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);
    const grace = await member(organizationId, 'grace@example.com');

    const linked = await ssoSignIn('grace@example.com', { sub: 'grace-1', email: 'grace@example.com' });
    expect((await linked.browser.get('/api/user').expect(200)).body).toMatchObject({ id: grace.id, role: 'viewer' });

    // A second identity claiming the same address does not take the account over.
    const impostor = await ssoSignIn('grace@example.com', { sub: 'someone-else', email: 'grace@example.com' });
    expect(impostor.back.headers.location).toBe('/auth?sso_error=account_linked');

    const [elsewhere] = await privilegedDb.insert(organizations).values({ name: 'Elsewhere' }).returning();
    await member(elsewhere.id, 'hedy@example.com');
    const refused = await ssoSignIn('hedy@example.com', { sub: 'hedy-1', email: 'hedy@example.com' });
    expect(refused.back.headers.location).toBe('/auth?sso_error=account_elsewhere');
    await refused.browser.get('/api/user').expect(401);
  });

  it('refuses what the organization did not allow, and says why on the sign-in page', async () => {
    const { agent } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);

    const nowhere = await request(app).get('/api/sso/start').query({ email: 'x@unknown.example' }).expect(303);
    expect(nowhere.headers.location).toBe('/auth?sso_error=unknown_domain');

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ sub: 'a', email: 'a@elsewhere.example' }, 'domain_not_allowed'],
      [{ sub: 'b', email: 'b@example.com', email_verified: false }, 'email_unverified'],
      [{ sub: 'c' }, 'no_email'],
    ];
    for (const [claims, error] of cases) {
      const { back, browser } = await ssoSignIn('someone@example.com', claims);
      expect(back.headers.location).toBe(`/auth?sso_error=${error}`);
      await browser.get('/api/user').expect(401);
    }
    expect(await privilegedDb.select().from(ssoIdentities)).toHaveLength(0);
  });

  it('accepts Entra ID\'s address-shaped preferred_username when there is no email claim', async () => {
    const { agent } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);
    const { browser } = await ssoSignIn('lin@example.com', { sub: 'lin-1', preferred_username: 'Lin@example.com' });
    expect((await browser.get('/api/user').expect(200)).body.username).toBe('lin@example.com');
  });

  it('refuses a callback whose state is not the one sent, and one with nothing pending', async () => {
    const { agent } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);
    const forged = await ssoSignIn('eve@example.com', { sub: 'eve', email: 'eve@example.com' }, (p) => p.set('state', 'forged'));
    expect(forged.back.headers.location).toBe('/auth?sso_error=provider_error');

    const cold = await request(app).get('/api/sso/callback?code=x&state=y').expect(303);
    expect(cold.headers.location).toBe('/auth?sso_error=expired');
  });

  it('sends nobody to a provider that is switched off', async () => {
    const { agent } = await owner();
    await agent.put('/api/organization/sso').send(settings({ enabled: false })).expect(200);
    const res = await request(app).get('/api/sso/start').query({ email: 'ada@example.com' }).expect(303);
    expect(res.headers.location).toBe('/auth?sso_error=unknown_domain');
    expect((await request(app).get('/api/sso/available')).body.available).toBe(false);
  });
});

describe('requiring single sign-on', () => {
  it('refuses members\' passwords, keeps owners\', and ends password sessions already open', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);
    await member(organizationId, 'max@example.com');

    const open = request.agent(app);
    await open.post('/api/login').send({ username: 'max@example.com', password: 'password123' }).expect(200);
    await open.get('/api/probe').expect(200);

    await agent.put('/api/organization/sso').send(settings({ clientSecret: '', required: true })).expect(200);

    const ended = await open.get('/api/probe').expect(401);
    expect(ended.body.code).toBe('sso_required');
    await open.get('/api/user').expect(401);

    const refused = await request(app).post('/api/login').send({ username: 'max@example.com', password: 'password123' }).expect(403);
    expect(refused.body.code).toBe('sso_required');
    // A wrong password says nothing about single sign-on.
    await request(app).post('/api/login').send({ username: 'max@example.com', password: 'wrong-password' }).expect(401);

    await request(app).post('/api/login').send({ username: 'olivia@example.com', password: 'password123' }).expect(200);
    const { browser } = await ssoSignIn('max@example.com', { sub: 'max-1', email: 'max@example.com' });
    await browser.get('/api/probe').expect(200);
  });

  it('does not ask for the organization\'s second factor on a session from the provider', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(settings()).expect(200);
    await privilegedDb.update(organizations).set({ mfaRequired: true }).where(eq(organizations.id, organizationId));

    const { browser } = await ssoSignIn('nia@example.com', { sub: 'nia-1', email: 'nia@example.com' });
    expect((await browser.get('/api/user').expect(200)).body.mfaEnrollmentRequired).toBe(false);
    await browser.get('/api/probe').expect(200);
  });
});
