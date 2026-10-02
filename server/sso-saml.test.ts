import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, sign, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { SignedXml } from 'xml-crypto';
import { privilegedDb } from './db';
import { auditLog, invitations, organizations, organizationSso, ssoSamlRequests, ssoSamlSessions, users } from '@shared/schema';
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
  unsolicited?: boolean;
  destination?: string;
  recipient?: string;
  sessionIndex?: string;
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
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData ${a.unsolicited ? '' : `InResponseTo="${inResponseTo}"`} NotOnOrAfter="${later.toISOString()}" Recipient="${a.recipient ?? acs}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${later.toISOString()}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${now.toISOString()}"${a.sessionIndex ? ` SessionIndex="${a.sessionIndex}"` : ''}><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
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
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${a.destination ?? acs}" ${a.unsolicited ? '' : `InResponseTo="${inResponseTo}"`}>` +
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

async function encryptedResponse(organizationId: number, requestId: string, a: Assertion = {}, cert = IDP_CERT) {
  const xml = Buffer.from(samlResponse(organizationId, requestId, a), 'base64').toString();
  const assertion = /<saml:Assertion\b[\s\S]*?<\/saml:Assertion>/.exec(xml)![0];
  const xmlenc = createRequire(import.meta.url)('xml-encryption');
  const encrypted = await new Promise<string>((resolve, reject) => xmlenc.encrypt(assertion, {
    rsa_pub: new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'pem' }), pem: cert,
    encryptionAlgorithm: 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
    keyEncryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
  }, (error: Error | null, value: string) => error ? reject(error) : resolve(value)));
  return Buffer.from(xml.replace(assertion, `<saml:EncryptedAssertion>${encrypted}</saml:EncryptedAssertion>`)).toString('base64');
}

function logoutXml(organizationId: number, options: { responseTo?: string; sessionIndex?: string; nameId?: string; destination?: string } = {}) {
  const type = options.responseTo ? 'LogoutResponse' : 'LogoutRequest';
  const id = `_logout${randomUUID()}`;
  return `<samlp:${type} xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${options.destination ?? `${BASE}/api/sso/saml/${organizationId}/slo`}"${options.responseTo ? ` InResponseTo="${options.responseTo}"` : ''}><saml:Issuer>${IDP_ENTITY}</saml:Issuer>${options.responseTo ? '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' : `<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${options.nameId ?? 'ada-1'}</saml:NameID><samlp:SessionIndex>${options.sessionIndex ?? 'session-1'}</samlp:SessionIndex>`}</samlp:${type}>`;
}
function signedLogoutPost(xml: string) {
  const sig = new SignedXml({ privateKey: IDP_KEY, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
  sig.addReference({ xpath: '/*', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
  sig.computeSignature(xml, { location: { reference: "//*[local-name()='Issuer']", action: 'after' } });
  return Buffer.from(sig.getSignedXml()).toString('base64');
}
function signedLogoutQuery(xml: string, response = false) {
  const query = new URLSearchParams({ [response ? 'SAMLResponse' : 'SAMLRequest']: deflateRawSync(Buffer.from(xml)).toString('base64'), SigAlg: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' }).toString();
  return `${query}&Signature=${encodeURIComponent(sign('RSA-SHA256', Buffer.from(query), IDP_KEY).toString('base64'))}`;
}
async function configuredSlo() {
  const { agent, organizationId } = await owner();
  await agent.put('/api/organization/sso').send(samlSettings({ samlSpCertificate: IDP_CERT, samlSpPrivateKey: IDP_KEY, samlSloUrl: 'https://idp.example.com/logout' })).expect(200);
  const browser = request.agent(app);
  const { requestId } = await startSignIn(browser, 'ada@example.com');
  const result = await postResponse(browser, organizationId, samlResponse(organizationId, requestId!, { email: 'ada@example.com', sessionIndex: 'session-1' }));
  expect(result.headers.location).toBe('/');
  return { agent, browser, organizationId };
}

describe('advanced SAML protocol security', () => {
  it('prevents a SAML registry row from linking another organization’s user', async () => {
    const { organizationId } = await owner();
    const outsider = await owner('outside@another.example');
    const [user] = await privilegedDb.select().from(users).where(eq(users.organizationId, outsider.organizationId));
    await expect(privilegedDb.insert(ssoSamlSessions).values({ sessionId: 'cross-tenant', organizationId, userId: user.id,
      issuer: IDP_ENTITY, nameId: 'foreign' })).rejects.toThrow(/foreign key/i);
  });
  it('decrypts signed encrypted assertions and refuses plaintext or misleading nested encryption markers', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(samlSettings({ samlSpCertificate: IDP_CERT, samlSpPrivateKey: IDP_KEY, samlRequireEncryptedAssertions: true })).expect(200);
    const browser = request.agent(app);
    let { requestId } = await startSignIn(browser, 'ada@example.com');
    const valid = await postResponse(browser, organizationId, await encryptedResponse(organizationId, requestId!, { email: 'ada@example.com' }));
    expect(valid.headers.location).toBe('/');
    ({ requestId } = await startSignIn(browser, 'ada@example.com'));
    const plaintext = Buffer.from(samlResponse(organizationId, requestId!, { email: 'ada@example.com' }), 'base64').toString();
    const misleading = plaintext.replace('<saml:Issuer>', '<samlp:Extensions><saml:EncryptedAssertion/></samlp:Extensions><saml:Issuer>');
    const denied = await postResponse(browser, organizationId, Buffer.from(misleading).toString('base64'));
    expect(denied.headers.location).toContain('sso_error=provider_error');
  });
  it('starts signed SP logout, ends the local session and accepts the correlated signed response only once', async () => {
    const { browser, organizationId } = await configuredSlo();
    const ended = await browser.post('/api/logout').expect(200);
    const location = new URL(ended.body.redirectUrl);
    expect(location.origin).toBe('https://idp.example.com');
    expect(location.searchParams.has('Signature')).toBe(true);
    const requestXml = inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest')!, 'base64')).toString();
    const requestId = /\sID="([^"]+)"/.exec(requestXml)![1];
    await browser.get('/api/user').expect(401);
    const callback = `/api/sso/saml/${organizationId}/slo?${signedLogoutQuery(logoutXml(organizationId, { responseTo: requestId }), true)}`;
    await browser.get(callback).expect(303);
    await browser.get(callback).expect(400);
    expect(await privilegedDb.select().from(ssoSamlSessions)).toHaveLength(0);
  });
  it.each(['GET', 'POST'])('revokes matching sessions with signed provider logout via %s without cookies', async method => {
    const { browser, organizationId } = await configuredSlo();
    const message = logoutXml(organizationId);
    const route = `/api/sso/saml/${organizationId}/slo`;
    const send = () => method === 'GET' ? request(app).get(`${route}?${signedLogoutQuery(message)}`) : request(app).post(route).set('Origin', 'https://idp.example.com').type('form').send({ SAMLRequest: signedLogoutPost(message) });
    const result = await send().expect(303);
    expect(result.headers.location).toContain('SAMLResponse=');
    await browser.get('/api/user').expect(401);
    await send().expect(400);
  });
  it('refuses unsigned, wrong-session and wrong-destination provider logout without ending a valid session', async () => {
    const { browser, organizationId } = await configuredSlo();
    const route = `/api/sso/saml/${organizationId}/slo`;
    await request(app).post(route).type('form').send({ SAMLRequest: Buffer.from(logoutXml(organizationId)).toString('base64') }).expect(400);
    for (const options of [{ sessionIndex: 'other-session' }, { destination: 'https://elsewhere.example/slo' }]) {
      await request(app).get(`${route}?${signedLogoutQuery(logoutXml(organizationId, options))}`).expect(400);
    }
    await browser.get('/api/user').expect(200);
  });
  it('bounds compressed logout XML before library verification', async () => {
    const { organizationId } = await configuredSlo();
    const bomb = deflateRawSync(Buffer.from('x'.repeat(1_000_001))).toString('base64');
    await request(app).get(`/api/sso/saml/${organizationId}/slo`).query({ SAMLRequest: bomb, SigAlg: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', Signature: 'invalid' }).expect(400);
  });
  it('logs out all sessions for the signed NameID when SessionIndex is absent', async () => {
    const { browser, organizationId } = await configuredSlo();
    const xml = logoutXml(organizationId).replace(/<samlp:SessionIndex>.*?<\/samlp:SessionIndex>/, '');
    await request(app).post(`/api/sso/saml/${organizationId}/slo`).type('form').send({ SAMLRequest: signedLogoutPost(xml) }).expect(303);
    await browser.get('/api/user').expect(401);
  });
});

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
    expect(parseIdpMetadata(xml)).toEqual({ entityId: IDP_ENTITY, ssoUrl: IDP_SSO, certificate: normaliseCertificate(IDP_CERT), sloUrl: null });
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
      sloUrl: `${BASE}/api/sso/saml/${organizationId}/slo`,
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
  it('keeps unsolicited login disabled by default, accepts opt-in signed login once and rejects wrong destination/recipient', async () => {
    const { agent, organizationId } = await owner();
    await agent.put('/api/organization/sso').send(samlSettings()).expect(200);
    const response = samlResponse(organizationId, '', { email: 'ada@example.com', unsolicited: true });
    expect((await postResponse(request.agent(app), organizationId, response)).headers.location).toContain('sso_error=provider_error');
    await agent.put('/api/organization/sso').send(samlSettings({ samlAllowIdpInitiated: true })).expect(200);
    expect((await postResponse(request.agent(app), organizationId, response)).headers.location).toBe('/');
    expect((await postResponse(request.agent(app), organizationId, response)).headers.location).toContain('sso_error=expired');
    for (const bad of [{ destination: 'https://evil.example' }, { recipient: 'https://evil.example' }, { unsigned: true }]) {
      expect((await postResponse(request.agent(app), organizationId, samlResponse(organizationId, '', { email: 'ada@example.com', unsolicited: true, ...bad }))).headers.location).toContain('sso_error=provider_error');
    }
  });

  it('encrypts a matching SP private key at rest, retains a blank key and never returns it', async () => {
    const { agent, organizationId } = await owner();
    const input = samlSettings({ samlSpPrivateKey: IDP_KEY, samlSpCertificate: IDP_CERT, samlSloUrl: `${IDP_SSO}/logout`, samlRequireEncryptedAssertions: true });
    const saved = await agent.put('/api/organization/sso').send(input).expect(200);
    expect(saved.body.settings.samlSpPrivateKeyConfigured).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain('PRIVATE KEY');
    const [stored] = await privilegedDb.select().from(organizationSso).where(eq(organizationSso.organizationId, organizationId));
    expect(stored.samlSpPrivateKeyEncrypted).toBeTruthy();
    expect(stored.samlSpPrivateKeyEncrypted).not.toContain('PRIVATE KEY');
    await agent.put('/api/organization/sso').send({ ...input, samlSpPrivateKey: '' }).expect(200);
    await agent.put('/api/organization/sso').send({ ...input, samlSpPrivateKey: OTHER_KEY }).expect(400);
    await agent.put('/api/organization/sso').send({ ...input, samlSpPrivateKey: '', samlClearSpKey: true }).expect(400);
    const metadata = await request(app).get(`/api/sso/saml/${organizationId}/metadata`).expect(200);
    expect(metadata.text).toContain('SingleLogoutService');
    expect(metadata.text).toContain('use="encryption"');
  });
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
