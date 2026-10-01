import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { SignedXml } from 'xml-crypto';
import { privilegedDb } from './db';
import { auditLog, invitations, organizations, ssoSamlRequests, users } from '@shared/schema';
import { inResponseToOf, normaliseCertificate, parseIdpMetadata, samlEmailOf, samlSubjectOf } from './sso-saml';

// SAML sign-in against the real (PGlite) test database. The identity provider is this file: it reads
// the AuthnRequest the product sends and answers with a Response whose assertion it signs with a test
// key (server/tests/fixtures). Only the logger is mocked.
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'tests', 'fixtures', name), 'utf8');
const IDP_KEY = fixture('saml-idp.key');
const IDP_CERT = fixture('saml-idp.crt');
const OTHER_KEY = fixture('saml-other.key');
const IDP_ENTITY = 'https://idp.example.com/saml';
const IDP_SSO = 'https://idp.example.com/saml/sso';
const BASE = 'http://127.0.0.1'; // supertest's host: the installation's public base in these tests

let app: Express;

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  const { setupAuth } = await import('./auth');
  const { tenancyMiddleware } = await import('./middleware/tenancy');
  const { requireSso } = await import('./middleware/require-sso');
  const { csrfOriginCheck } = await import('./middleware/csrf');
  const ssoRoutes = (await import('./routes/sso.routes')).default;
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(csrfOriginCheck);
  setupAuth(app);
  app.use(tenancyMiddleware);
  app.use(requireSso);
  app.use(ssoRoutes);
});

beforeEach(async () => {
  process.env.WEBFLOW_PUBLIC_URL = BASE;
  await privilegedDb.delete(ssoSamlRequests);
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const samlSettings = (overrides: Record<string, unknown> = {}) => ({
  protocol: 'saml',
  issuer: IDP_ENTITY,
  samlSsoUrl: IDP_SSO,
  samlCertificate: IDP_CERT,
  domains: ['example.com'],
  defaultRole: 'editor',
  enabled: true,
  required: false,
  ...overrides,
});

async function owner(username = 'olivia@example.com') {
  const agent = request.agent(app);
  const res = await agent.post('/api/register').send({ username, password: 'password123' }).expect(201);
  return { agent, organizationId: res.body.organizationId as number };
}

// ─── The identity provider ──────────────────────────────────────────────────────

interface Assertion {
  email?: string;
  nameId?: string;
  nameIdFormat?: string;
  issuer?: string;
  audience?: string;
  notOnOrAfter?: Date;
  key?: string;
  /** Leave the assertion unsigned. */
  unsigned?: boolean;
}

function samlResponse(organizationId: number, inResponseTo: string, a: Assertion = {}): string {
  const now = new Date();
  const later = a.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const acs = `${BASE}/api/sso/saml/${organizationId}/acs`;
  const audience = a.audience ?? `${BASE}/api/sso/saml/${organizationId}`;
  const issuer = a.issuer ?? IDP_ENTITY;
  const assertionId = `_a${randomUUID()}`;
  const attributes = a.email
    ? `<saml:AttributeStatement><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>${a.email}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>`
    : '';
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="${a.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'}">${a.nameId ?? 'ada-1'}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${later.toISOString()}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${later.toISOString()}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    attributes +
    `</saml:Assertion>`;
  let signed = assertion;
  if (!a.unsigned) {
    const sig = new SignedXml({
      privateKey: a.key ?? IDP_KEY,
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    });
    sig.addReference({
      xpath: `//*[@ID='${assertionId}']`,
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sig.computeSignature(assertion, { location: { reference: `//*[local-name()='Issuer']`, action: 'after' } });
    signed = sig.getSignedXml();
  }
  const response =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${acs}" InResponseTo="${inResponseTo}">` +
    `<saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    signed +
    `</samlp:Response>`;
  return Buffer.from(response).toString('base64');
}

/** Out to the provider: the AuthnRequest's id, read from the redirect. */
async function startSignIn(browser: ReturnType<typeof request.agent>, email: string) {
  const start = await browser.get('/api/sso/start').query({ email }).expect(303);
  const location = new URL(start.headers.location, BASE);
  if (!location.href.startsWith(IDP_SSO)) return { start, requestId: null as string | null };
  const xml = inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest')!, 'base64')).toString();
  return { start, requestId: /\sID="([^"]+)"/.exec(xml)![1], xml };
}

async function postResponse(browser: ReturnType<typeof request.agent>, organizationId: number, body: string, origin = 'https://idp.example.com') {
  return browser.post(`/api/sso/saml/${organizationId}/acs`).set('Origin', origin).type('form').send({ SAMLResponse: body }).expect(303);
}

// ─── Pure parts ─────────────────────────────────────────────────────────────────

describe('reading what an owner pastes', () => {
  it('accepts a certificate as PEM or as the bare base64 of metadata, and refuses anything else', () => {
    const bare = IDP_CERT.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, '');
    expect(normaliseCertificate(IDP_CERT)).toContain('BEGIN CERTIFICATE');
    expect(normaliseCertificate(bare)).toBe(normaliseCertificate(IDP_CERT));
    expect(normaliseCertificate('not a certificate')).toBeNull();
    expect(normaliseCertificate('QUJD')).toBeNull();
  });

  it('reads entity ID, redirect sign-on URL and signing certificate from IdP metadata, and refuses a DOCTYPE', () => {
    const bare = IDP_CERT.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, '');
    const xml = `<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP_ENTITY}">
      <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${bare}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
        <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${IDP_SSO}/post"/>
        <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${IDP_SSO}"/>
      </md:IDPSSODescriptor></md:EntityDescriptor>`;
    expect(parseIdpMetadata(xml)).toEqual({ entityId: IDP_ENTITY, ssoUrl: IDP_SSO, certificate: normaliseCertificate(IDP_CERT) });
    expect(parseIdpMetadata(`<!DOCTYPE x [<!ENTITY a "b">]>${xml}`)).toEqual({ error: 'The metadata must not contain a DOCTYPE.' });
    expect(parseIdpMetadata('<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"/>')).toHaveProperty('error');
  });

  it('finds the address in the usual attributes or an address-shaped NameID, and keys transient NameIDs by address', () => {
    expect(samlEmailOf({ nameID: 'x', mail: 'Ada@Example.com' })).toBe('ada@example.com');
    expect(samlEmailOf({ nameID: 'ada@example.com' })).toBe('ada@example.com');
    expect(samlEmailOf({ nameID: 'ada-1' })).toBeNull();
    expect(samlSubjectOf({ nameID: 'abc', nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' }, 'ada@example.com')).toBe('email:ada@example.com');
    expect(samlSubjectOf({ nameID: 'abc', nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' }, 'ada@example.com')).toBe('abc');
    expect(inResponseToOf(Buffer.from('<samlp:Response xmlns:samlp="p" InResponseTo="_x1"><a InResponseTo="_no"/></samlp:Response>').toString('base64'))).toBe('_x1');
  });
});

// ─── Through the product ────────────────────────────────────────────────────────

describe('setting SAML up', () => {
  it('saves a SAML provider, publishes the service provider metadata, and the test checks the certificate', async () => {
    const { agent, organizationId } = await owner();
    const saved = await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
    expect(saved.body.settings).toMatchObject({ protocol: 'saml', issuer: IDP_ENTITY, samlSsoUrl: IDP_SSO, clientId: null });
    expect(saved.body.settings.samlCertificateInfo).toMatchObject({ expired: false, subject: expect.stringContaining('test-idp') });
    expect(saved.body.saml).toEqual({
      entityId: `${BASE}/api/sso/saml/${organizationId}`,
      acsUrl: `${BASE}/api/sso/saml/${organizationId}/acs`,
      metadataUrl: `${BASE}/api/sso/saml/${organizationId}/metadata`,
    });

    const metadata = await request(app).get(`/api/sso/saml/${organizationId}/metadata`).expect(200);
    expect(metadata.text).toContain(`entityID="${BASE}/api/sso/saml/${organizationId}"`);
    expect(metadata.text).toContain(`Location="${BASE}/api/sso/saml/${organizationId}/acs"`);

    const [entry] = (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId))).filter((e) => e.action === 'sso.configured');
    expect(entry.metadata).toMatchObject({ protocol: 'saml', issuer: IDP_ENTITY });
    expect((entry.metadata as Record<string, unknown>).certificateFingerprint).toMatch(/^[0-9A-F:]+$/);
  });

  it('refuses a SAML provider without a sign-on URL or a usable certificate, and needs no client secret', async () => {
    const { agent } = await owner();
    expect((await agent.put('/api/organization/sso').send(samlSettings({ samlSsoUrl: 'ftp://idp' })).expect(400)).body.code).toBe('invalid_sso_url');
    expect((await agent.put('/api/organization/sso').send(samlSettings({ samlCertificate: 'nope' })).expect(400)).body.code).toBe('invalid_certificate');
    expect((await agent.put('/api/organization/sso').send(samlSettings({ issuer: 'has spaces' })).expect(400)).body.code).toBe('invalid_issuer');
    // Back to OpenID Connect without a secret: there is none stored.
    await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
    const back = await agent.put('/api/organization/sso').send({ ...samlSettings(), protocol: 'oidc', issuer: 'https://login.example.com', clientId: 'x' }).expect(400);
    expect(back.body.code).toBe('secret_required');
  });

  it('fills the form from pasted metadata', async () => {
    const { agent } = await owner();
    const bare = IDP_CERT.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, '');
    const xml = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP_ENTITY}"><md:IDPSSODescriptor><md:KeyDescriptor><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${bare}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${IDP_SSO}"/></md:IDPSSODescriptor></md:EntityDescriptor>`;
    const res = await agent.post('/api/organization/sso/saml-metadata').send({ xml });
    expect(res.body.error ?? null).toBeNull();
    expect(res.body).toMatchObject({ entityId: IDP_ENTITY, ssoUrl: IDP_SSO });
  });
});

describe('signing in with SAML', () => {
  it('sends an AuthnRequest, accepts the signed answer, creates the account, and finds it again by NameID', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(samlSettings()).expect(200);

    const browser = request.agent(app);
    const { requestId, xml } = await startSignIn(browser, 'ada@example.com');
    expect(xml).toContain(`AssertionConsumerServiceURL="${BASE}/api/sso/saml/${organizationId}/acs"`);
    const back = await postResponse(browser, organizationId, samlResponse(organizationId, requestId!, { email: 'Ada@Example.com' }));
    expect(back.headers.location).toBe('/');
    const me = await browser.get('/api/user').expect(200);
    expect(me.body).toMatchObject({ username: 'ada@example.com', role: 'editor', organizationId, signedInWithSso: true });

    const again = request.agent(app);
    const second = await startSignIn(again, 'ada@example.com');
    await postResponse(again, organizationId, samlResponse(organizationId, second.requestId!, { email: 'ada.l@example.com' }));
    expect((await again.get('/api/user').expect(200)).body.id).toBe(me.body.id);

    const actions = (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId))).map((e) => e.action);
    expect(actions.filter((a) => a === 'member.provisioned')).toHaveLength(1);
  });

  it('refuses a replayed response, an unsolicited one, and one answering another organization', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
    const browser = request.agent(app);
    const { requestId } = await startSignIn(browser, 'ada@example.com');
    const body = samlResponse(organizationId, requestId!, { email: 'ada@example.com' });
    expect((await postResponse(browser, organizationId, body)).headers.location).toBe('/');

    const thief = request.agent(app);
    expect((await postResponse(thief, organizationId, body)).headers.location).toBe('/auth?sso_error=expired');
    expect((await postResponse(thief, organizationId, samlResponse(organizationId, '_never-sent', { email: 'ada@example.com' }))).headers.location).toBe('/auth?sso_error=expired');
    await thief.get('/api/user').expect(401);
  });

  it('refuses a forged signature, an unsigned assertion, the wrong issuer or audience, and an expired assertion', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
    const cases: Assertion[] = [
      { email: 'ada@example.com', key: OTHER_KEY },
      { email: 'ada@example.com', unsigned: true },
      { email: 'ada@example.com', issuer: 'https://evil.example.com' },
      { email: 'ada@example.com', audience: 'https://someone-else.example.com' },
      { email: 'ada@example.com', notOnOrAfter: new Date(Date.now() - 10 * 60_000) },
    ];
    for (const assertion of cases) {
      const browser = request.agent(app);
      const { requestId } = await startSignIn(browser, 'ada@example.com');
      const back = await postResponse(browser, organizationId, samlResponse(organizationId, requestId!, assertion));
      expect(back.headers.location, JSON.stringify({ ...assertion, key: assertion.key ? 'other' : undefined })).toBe('/auth?sso_error=provider_error');
      await browser.get('/api/user').expect(401);
    }
    expect(await privilegedDb.select().from(users).where(eq(users.username, 'ada@example.com'))).toHaveLength(0);
  });

  it('refuses an address outside the organization\'s domains, and an assertion with no address', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
    let browser = request.agent(app);
    let started = await startSignIn(browser, 'ada@example.com');
    expect((await postResponse(browser, organizationId, samlResponse(organizationId, started.requestId!, { email: 'eve@elsewhere.test' }))).headers.location).toBe('/auth?sso_error=domain_not_allowed');
    browser = request.agent(app);
    started = await startSignIn(browser, 'ada@example.com');
    expect((await postResponse(browser, organizationId, samlResponse(organizationId, started.requestId!, { nameId: 'opaque-id' }))).headers.location).toBe('/auth?sso_error=no_email');
  });

  it('with Secure cookies, accepts the response only in the browser that started the sign-in', async () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    try {
      const { agent, organizationId } = await owner();
      await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
      const victim = request.agent(app);
      const attacker = request.agent(app);
      const { start, requestId } = await startSignIn(attacker, 'mallory@example.com');
      expect(String(start.headers['set-cookie'])).toMatch(/wfm_saml_request=.*SameSite=None.*Secure|wfm_saml_request=.*Secure.*SameSite=None/);
      // The attacker hands the victim's browser a response to the attacker's own request.
      const res = await victim
        .post(`/api/sso/saml/${organizationId}/acs`)
        .set('Origin', 'https://idp.example.com')
        .type('form')
        .send({ SAMLResponse: samlResponse(organizationId, requestId!, { email: 'mallory@example.com' }) })
        .expect(303);
      expect(res.headers.location).toBe('/auth?sso_error=browser_mismatch');
      // In the browser that started it, with its cookie, it works.
      const bound = await request(app)
        .post(`/api/sso/saml/${organizationId}/acs`)
        .set('Origin', 'https://idp.example.com')
        .set('Cookie', `wfm_saml_request=${encodeURIComponent(requestId!)}`)
        .type('form')
        .send({ SAMLResponse: samlResponse(organizationId, requestId!, { email: 'mallory@example.com' }) })
        .expect(303);
      expect(bound.headers.location).toBe('/');
    } finally {
      delete process.env.SESSION_COOKIE_SECURE;
    }
  });

  it('keeps the cross-site exemption to the ACS only', async () => {
    const { agent } = await owner();
    await agent.put('/api/organization/sso').set('Origin', 'https://idp.example.com').send(samlSettings()).expect(403);
  });
});
