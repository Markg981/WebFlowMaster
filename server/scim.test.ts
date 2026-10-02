import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { auditLog, invitations, organizations, scimGroups, tests, users } from '@shared/schema';

// SCIM against the real (PGlite) test database, as Entra ID and Okta talk to it. Only the logger is mocked.
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  const { setupAuth } = await import('./auth');
  const { tenancyMiddleware } = await import('./middleware/tenancy');
  const ssoRoutes = (await import('./routes/sso.routes')).default;
  const { default: scimRoutes, SCIM_BASE_PATH } = await import('./routes/scim.routes');
  app = express();
  app.use(express.json());
  setupAuth(app);
  app.use(tenancyMiddleware);
  app.use(ssoRoutes);
  app.use(SCIM_BASE_PATH, scimRoutes);
  app.get('/api/probe', (req, res) => (req.isAuthenticated() ? res.json({ id: req.user!.id, role: req.user!.role }) : res.sendStatus(401)));
});

beforeEach(async () => {
  const { resetScimUsageThrottle } = await import('./scim');
  resetScimUsageThrottle();
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(tests);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const SCIM = 'application/scim+json';

/** An organization with single sign-on for example.com, its owner signed in, and a SCIM token. */
async function provisioned(roleMappings: Array<{ group: string; role: string }> = []) {
  const owner = request.agent(app);
  const registered = await owner.post('/api/register').send({ username: 'olivia@example.com', password: 'password123' }).expect(201);
  await owner
    .put('/api/organization/sso')
    .send({ issuer: 'https://idp.example.com', clientId: 'wfm', clientSecret: 's', domains: ['example.com'], defaultRole: 'viewer', enabled: true, required: false, roleMappings })
    .expect(200);
  const issued = await owner.post('/api/organization/sso/scim-token').expect(201);
  const token = issued.body.token as string;
  const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
    request(app)[method](`/api/scim/v2${path}`).set('Authorization', `Bearer ${token}`).set('Content-Type', SCIM);
  return { owner, ownerId: registered.body.id as number, organizationId: registered.body.organizationId as number, token, call, issued: issued.body };
}

async function actions(organizationId: number) {
  return (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId))).map((e) => e.action);
}

describe('the token', () => {
  it('is issued once to an owner, shown by prefix only, and refused once revoked', async () => {
    const { owner, token, call, issued, organizationId } = await provisioned();
    expect(token).toMatch(/^wfmscim_/);
    expect(issued.baseUrl).toMatch(/\/api\/scim\/v2$/);
    const settings = (await owner.get('/api/organization/sso').expect(200)).body;
    expect(settings.settings.scimToken).toMatchObject({ prefix: token.slice(0, 16) });
    expect(JSON.stringify(settings)).not.toContain(token);
    expect(settings.scim.baseUrl).toMatch(/\/api\/scim\/v2$/);

    await call('get', '/ServiceProviderConfig').expect(200);
    await owner.delete('/api/organization/sso/scim-token').expect(204);
    const refused = await call('get', '/Users').expect(401);
    expect(refused.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(await actions(organizationId)).toEqual(expect.arrayContaining(['scim.token_issued', 'scim.token_revoked']));
    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(JSON.stringify(entries)).not.toContain(token);
  });

  it('needs single sign-on, and is refused without a token or with someone else\'s scheme', async () => {
    const owner = request.agent(app);
    await owner.post('/api/register').send({ username: 'nora@example.org', password: 'password123' }).expect(201);
    await owner.post('/api/organization/sso/scim-token').expect(404);
    await request(app).get('/api/scim/v2/Users').expect(401);
    await request(app).get('/api/scim/v2/Users').set('Authorization', 'Bearer wfmscim_nothing').expect(401);
    await request(app).get('/api/scim/v2/Users').set('Authorization', 'Basic YTpi').expect(401);
  });

  it('names one organization: another organization\'s members are not there', async () => {
    const first = await provisioned();
    const [other] = await privilegedDb.insert(organizations).values({ name: 'Other' }).returning();
    await privilegedDb.insert(users).values({ username: 'stranger@other.example', password: 'x.y', organizationId: other.id, role: 'owner' });
    const list = await first.call('get', '/Users').expect(200);
    expect(list.body.Resources.map((u: { userName: string }) => u.userName)).toEqual(['olivia@example.com']);
  });
});

describe('users', () => {
  it('creates an account Entra ID can find again by userName, with the default role', async () => {
    const { call, organizationId } = await provisioned();
    const created = await call('post', '/Users')
      .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'Ada@Example.com', externalId: 'ada-oid', active: true, name: { givenName: 'Ada' } })
      .expect(201);
    expect(created.headers['content-type']).toContain(SCIM);
    expect(created.headers.location).toBe(created.body.meta.location);
    expect(created.body).toMatchObject({ userName: 'ada@example.com', externalId: 'ada-oid', active: true });

    const [account] = await privilegedDb.select().from(users).where(eq(users.id, Number(created.body.id)));
    expect(account).toMatchObject({ username: 'ada@example.com', role: 'viewer', organizationId, kind: 'person', disabledAt: null });

    const found = await call('get', '/Users').query({ filter: 'userName eq "ada@example.com"' }).expect(200);
    expect(found.body).toMatchObject({ totalResults: 1, Resources: [{ id: created.body.id }] });
    expect((await call('get', '/Users').query({ filter: 'externalId eq "ada-oid"' }).expect(200)).body.totalResults).toBe(1);
    expect((await call('get', '/Users').query({ filter: 'userName eq "nobody@example.com"' }).expect(200)).body.totalResults).toBe(0);
    await call('get', '/Users').query({ filter: 'userName sw "a"' }).expect(400);

    const again = await call('post', '/Users').send({ userName: 'ada@example.com' }).expect(409);
    expect(again.body.scimType).toBe('uniqueness');
    expect(await actions(organizationId)).toContain('member.provisioned');
  });

  it('refuses an address outside the single sign-on domains', async () => {
    const { call } = await provisioned();
    expect((await call('post', '/Users').send({ userName: 'eve@elsewhere.example' }).expect(400)).body.scimType).toBe('invalidValue');
    await call('post', '/Users').send({ userName: 'not-an-address' }).expect(400);
    await call('post', '/Users').send({}).expect(400);
  });

  it('deactivates at once — sessions end, sign-in is refused — and reactivates', async () => {
    const { call, organizationId } = await provisioned();
    const { hashPassword } = await import('./auth');
    const [grace] = await privilegedDb
      .insert(users)
      .values({ username: 'grace@example.com', password: await hashPassword('password123'), organizationId, role: 'editor' })
      .returning();
    const session = request.agent(app);
    await session.post('/api/login').send({ username: 'grace@example.com', password: 'password123' }).expect(200);
    await session.get('/api/probe').expect(200);

    // Entra ID's spelling: "Replace", and the boolean as a string.
    const patched = await call('patch', `/Users/${grace.id}`)
      .send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })
      .expect(200);
    expect(patched.body.active).toBe(false);
    await session.get('/api/probe').expect(401);
    await request(app).post('/api/login').send({ username: 'grace@example.com', password: 'password123' }).expect(401);

    // Okta's spelling: no path, an object of attributes.
    await call('patch', `/Users/${grace.id}`).send({ Operations: [{ op: 'replace', value: { active: true } }] }).expect(200);
    await request(app).post('/api/login').send({ username: 'grace@example.com', password: 'password123' }).expect(200);
    const [after] = await privilegedDb.select().from(users).where(eq(users.id, grace.id));
    expect(after.role).toBe('editor');
    expect(await actions(organizationId)).toEqual(expect.arrayContaining(['member.deactivated', 'member.reactivated']));
  });

  it('renames with PUT and keeps what it does not hold', async () => {
    const { call } = await provisioned();
    const created = await call('post', '/Users').send({ userName: 'lin@example.com', externalId: 'x1' }).expect(201);
    const replaced = await call('put', `/Users/${created.body.id}`).send({ userName: 'lin.wei@example.com', active: true, title: 'Engineer' }).expect(200);
    expect(replaced.body).toMatchObject({ userName: 'lin.wei@example.com', externalId: 'x1', active: true });
    await call('put', `/Users/${created.body.id}`).send({ userName: 'olivia@example.com' }).expect(409);
    await call('get', '/Users/999999').expect(404);
  });

  it('never deactivates or removes the last active owner', async () => {
    const { call, ownerId } = await provisioned();
    expect((await call('patch', `/Users/${ownerId}`).send({ Operations: [{ op: 'replace', path: 'active', value: false }] }).expect(409)).body.scimType).toBe('mutability');
    await call('delete', `/Users/${ownerId}`).expect(409);
  });

  it('removes a member, handing what they made to the owner', async () => {
    const { call, organizationId, ownerId } = await provisioned();
    const created = await call('post', '/Users').send({ userName: 'max@example.com' }).expect(201);
    const id = Number(created.body.id);
    const [test] = await privilegedDb.insert(tests).values({ userId: id, organizationId, name: 'Checkout', url: 'https://shop.example', sequence: [], elements: [], status: 'draft' }).returning();
    await call('delete', `/Users/${id}`).expect(204);
    expect(await privilegedDb.select().from(users).where(eq(users.id, id))).toEqual([]);
    const [kept] = await privilegedDb.select().from(tests).where(eq(tests.id, test.id));
    expect(kept.userId).toBe(ownerId);
    const removal = (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId))).find((e) => e.action === 'member.removed');
    expect(removal).toMatchObject({ actorUsername: 'SCIM', metadata: expect.objectContaining({ byScim: true, transferredTo: 'olivia@example.com' }) });
    await call('get', `/Users/${id}`).expect(404);
  });
});

describe('groups', () => {
  it('gives roles from the mapped groups as soon as the membership changes', async () => {
    const { call, organizationId } = await provisioned([
      { group: 'wfm-editors', role: 'editor' },
      { group: '7f2c-owners-oid', role: 'owner' },
    ]);
    const ada = (await call('post', '/Users').send({ userName: 'ada@example.com' }).expect(201)).body.id;
    const bob = (await call('post', '/Users').send({ userName: 'bob@example.com' }).expect(201)).body.id;
    const role = async (id: string) => (await privilegedDb.select().from(users).where(eq(users.id, Number(id))))[0].role;

    const editors = await call('post', '/Groups').send({ displayName: 'WFM-Editors', members: [{ value: ada }] }).expect(201);
    expect(editors.body.members).toEqual([expect.objectContaining({ value: ada, display: 'ada@example.com' })]);
    expect(await role(ada)).toBe('editor');

    // Okta adds, and Entra ID removes with a filter in the path.
    await call('patch', `/Groups/${editors.body.id}`).send({ Operations: [{ op: 'add', path: 'members', value: [{ value: bob }] }] }).expect(200);
    expect(await role(bob)).toBe('editor');
    // Entra ID's group carries the object id the token's groups claim would.
    const owners = await call('post', '/Groups').send({ displayName: 'Owners', externalId: '7f2c-owners-oid', members: [{ value: bob }] }).expect(201);
    expect(await role(bob)).toBe('owner');

    await call('patch', `/Groups/${owners.body.id}`).send({ Operations: [{ op: 'remove', path: `members[value eq "${bob}"]` }] }).expect(200);
    expect(await role(bob)).toBe('editor');
    // In no mapped group any more: the role stays, as at sign-in.
    await call('delete', `/Groups/${editors.body.id}`).expect(204);
    expect(await role(ada)).toBe('editor');

    const changed = (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId))).filter((e) => e.action === 'member.role_changed');
    expect(changed.length).toBe(4);
    expect(changed.every((e) => (e.metadata as { byScim?: boolean }).byScim)).toBe(true);
  });

  it('lists, filters and pages groups, without members when asked', async () => {
    const { call } = await provisioned();
    for (const name of ['Alpha', 'Beta', 'Gamma']) await call('post', '/Groups').send({ displayName: name }).expect(201);
    await call('post', '/Groups').send({ displayName: 'alpha' }).expect(409);
    const page = await call('get', '/Groups').query({ startIndex: 2, count: 1, excludedAttributes: 'members' }).expect(200);
    expect(page.body).toMatchObject({ totalResults: 3, startIndex: 2, itemsPerPage: 1, Resources: [{ displayName: 'Beta' }] });
    expect(page.body.Resources[0].members).toBeUndefined();
    const found = await call('get', '/Groups').query({ filter: 'displayName eq "gamma"' }).expect(200);
    expect(found.body.Resources.map((g: { displayName: string }) => g.displayName)).toEqual(['Gamma']);
  });

  it('refuses members who are not people of the organization', async () => {
    const { call } = await provisioned();
    const [other] = await privilegedDb.insert(organizations).values({ name: 'Other' }).returning();
    const [stranger] = await privilegedDb.insert(users).values({ username: 'x@other.example', password: 'x.y', organizationId: other.id, role: 'owner' }).returning();
    await call('post', '/Groups').send({ displayName: 'G', members: [{ value: String(stranger.id) }] }).expect(400);
    expect(await privilegedDb.select().from(scimGroups)).toEqual([]);
  });

  it('applies mappings saved later to the groups already pushed', async () => {
    const { owner, call } = await provisioned();
    const ada = (await call('post', '/Users').send({ userName: 'ada@example.com' }).expect(201)).body.id;
    await call('post', '/Groups').send({ displayName: 'wfm-editors', members: [{ value: ada }] }).expect(201);
    expect((await privilegedDb.select().from(users).where(eq(users.id, Number(ada))))[0].role).toBe('viewer');
    await owner
      .put('/api/organization/sso')
      .send({ issuer: 'https://idp.example.com', clientId: 'wfm', domains: ['example.com'], defaultRole: 'viewer', enabled: true, required: false, roleMappings: [{ group: 'wfm-editors', role: 'editor' }] })
      .expect(200);
    expect((await privilegedDb.select().from(users).where(eq(users.id, Number(ada))))[0].role).toBe('editor');
  });
});

describe('discovery', () => {
  it('describes itself as SCIM clients expect', async () => {
    const { call } = await provisioned();
    const config = await call('get', '/ServiceProviderConfig').expect(200);
    expect(config.body).toMatchObject({ patch: { supported: true }, bulk: { supported: false }, filter: { supported: true } });
    expect((await call('get', '/ResourceTypes').expect(200)).body.Resources.map((r: { id: string }) => r.id)).toEqual(['User', 'Group']);
    expect((await call('get', '/Schemas').expect(200)).body.totalResults).toBe(2);
    expect((await call('get', '/Nothing').expect(404)).body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
  });
});
