import { X509Certificate, createHash, createPrivateKey } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { and, eq, lt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { SignedXml } from 'xml-crypto';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';
import { organizationSso, ssoDomains, ssoSamlRequests, ssoSamlReplay, ssoSamlSessions } from '@shared/schema';
import { privilegedDb } from './db';
import { groupsOf } from '@shared/sso-roles';
import { usableDomain } from './sso-domains';
import { decryptSecret } from './crypto';

/**
 * Single sign-on with SAML 2.0: the second language an organization's identity provider can speak,
 * next to OpenID Connect (server/sso.ts, which owns the settings and the accounts).
 *
 * The service provider is the organization, not the installation: each organization has its own
 * entity ID, assertion consumer service (ACS) and metadata, under /api/sso/saml/<organization id>/,
 * so one installation can serve organizations with different providers and the ACS knows, before
 * reading anything, whose provider's certificate to check the response with.
 *
 *   1. /api/sso/start finds the organization from the e-mail domain and redirects the browser to the
 *      provider with an AuthnRequest (HTTP-Redirect binding). The request id is stored.
 *   2. The provider POSTs a signed Response to the ACS. node-saml checks the signature against the
 *      stored certificate, the issuer, the audience (our entity ID), the time conditions and that it
 *      answers a request we sent; then the request is consumed atomically, so the same response
 *      cannot be used twice, not even by two web servers at the same instant.
 *   3. The e-mail (an attribute, or the NameID when it is an address) must be in one of the
 *      organization's domains; the account is found or created exactly as with OpenID Connect.
 *
 * The provider's POST is cross-site, so the SameSite=Lax session cookie does not come with it: the
 * pending request lives in the database (sso_saml_requests), not in the session. To keep somebody
 * from starting a sign-in and handing the response to someone else's browser (login CSRF), the start
 * also sets a short-lived cookie naming the request — SameSite=None where cookies are Secure — and
 * the ACS requires it to match when it is there to be checked.
 */

/** How long the provider has to answer an AuthnRequest. */
export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const BINDING_COOKIE = 'wfm_saml_request';
export const SLO_BINDING_COOKIE = 'wfm_saml_logout';
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';

export type SamlRow = Pick<typeof organizationSso.$inferSelect, 'organizationId' | 'issuer' | 'samlSsoUrl' | 'samlCertificate'> &
  Partial<Pick<typeof organizationSso.$inferSelect, 'groupAttribute' | 'samlAllowIdpInitiated' | 'samlRequireEncryptedAssertions' | 'samlSloUrl' | 'samlSpCertificate' | 'samlSpPrivateKeyEncrypted' | 'samlSpPrivateKeyIv' | 'samlSpPrivateKeyAuthTag'>>;

export interface SamlSessionIdentity {
  organizationId: number;
  issuer: string;
  nameId: string;
  nameIdFormat: string | null;
  sessionIndex: string | null;
}

// ─── The service provider's addresses ───────────────────────────────────────────

export function spUrls(publicBase: string, organizationId: number) {
  const root = `${publicBase.replace(/\/+$/, '')}/api/sso/saml/${organizationId}`;
  return { entityId: root, acsUrl: `${root}/acs`, metadataUrl: `${root}/metadata`, sloUrl: `${root}/slo` };
}

// ─── Certificates and metadata ──────────────────────────────────────────────────

/** A PEM certificate from what an owner pasted: PEM, or the bare base64 of an IdP's metadata. */
export function normaliseCertificate(value: string): string | null {
  const body = value
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  try {
    new X509Certificate(pem);
    return pem;
  } catch {
    return null;
  }
}

export interface CertificateInfo {
  subject: string;
  validTo: string;
  expired: boolean;
  fingerprint256: string;
}

export function certificateInfo(pem: string, now = new Date()): CertificateInfo | null {
  try {
    const cert = new X509Certificate(pem);
    return {
      subject: cert.subject.replace(/\n/g, ', '),
      validTo: new Date(cert.validTo).toISOString(),
      expired: new Date(cert.validTo).getTime() < now.getTime(),
      fingerprint256: cert.fingerprint256,
    };
  } catch {
    return null;
  }
}

export interface IdpMetadata {
  entityId: string;
  ssoUrl: string;
  certificate: string;
  sloUrl: string | null;
}

const MD = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

/**
 * The three values an owner needs, read from the provider's metadata XML (Entra ID, Okta, ADFS and
 * Keycloak all publish one). Only reads: nothing in it is trusted until the owner saves it.
 */
export function parseIdpMetadata(xml: string): IdpMetadata | { error: string } {
  if (xml.length > 1_000_000) return { error: 'The metadata is larger than 1 MB.' };
  // No DOCTYPE: it is how XML entity expansion attacks start, and metadata never needs one.
  if (/<!DOCTYPE/i.test(xml)) return { error: 'The metadata must not contain a DOCTYPE.' };
  let doc: Document;
  try {
    doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } }).parseFromString(xml, 'text/xml') as unknown as Document;
  } catch {
    return { error: 'This is not XML.' };
  }
  const entity = doc.getElementsByTagNameNS(MD, 'EntityDescriptor')[0];
  const idp = entity?.getElementsByTagNameNS(MD, 'IDPSSODescriptor')[0];
  if (!entity || !idp) return { error: 'No identity provider (IDPSSODescriptor) in this metadata.' };
  const entityId = entity.getAttribute('entityID') || '';
  const services = Array.from(idp.getElementsByTagNameNS(MD, 'SingleSignOnService'));
  const redirect = services.find((s) => s.getAttribute('Binding') === REDIRECT_BINDING);
  if (!redirect) return { error: 'The provider offers no HTTP-Redirect sign-on service, which is the one this product uses.' };
  const keys = Array.from(idp.getElementsByTagNameNS(MD, 'KeyDescriptor')).filter((k) => (k.getAttribute('use') || 'signing') === 'signing');
  const certText = keys.map((k) => k.getElementsByTagNameNS(DS, 'X509Certificate')[0]?.textContent ?? '').find((t) => t.trim());
  const certificate = certText ? normaliseCertificate(certText) : null;
  if (!entityId) return { error: 'The metadata has no entityID.' };
  if (!certificate) return { error: 'The metadata has no usable signing certificate.' };
  const logout = Array.from(idp.getElementsByTagNameNS(MD, 'SingleLogoutService')).find(s => s.getAttribute('Binding') === REDIRECT_BINDING);
  return { entityId, ssoUrl: redirect.getAttribute('Location') ?? '', certificate, sloUrl: logout?.getAttribute('Location') || null };
}

// ─── Pending requests ───────────────────────────────────────────────────────────

/**
 * Where node-saml keeps the requests it sent. Saving is real; getting tells it whether a request is
 * known; removing is left to consumeRequest, which deletes atomically after a response succeeds —
 * node-saml reads an id twice while validating, so deleting on its first read would refuse every
 * valid response.
 */
function cacheFor(organizationId: number, purpose: 'authn' | 'logout' = 'authn', sessionId?: string): CacheProvider {
  return {
    async saveAsync(key, value) {
      await privilegedDb.insert(ssoSamlRequests).values({ id: key, organizationId, purpose, sessionId }).onConflictDoNothing();
      return { value, createdAt: Date.now() };
    },
    async getAsync(key) {
      const [row] = await privilegedDb
        .select({ createdAt: ssoSamlRequests.createdAt })
        .from(ssoSamlRequests)
        .where(and(eq(ssoSamlRequests.id, key), eq(ssoSamlRequests.organizationId, organizationId), eq(ssoSamlRequests.purpose, purpose)));
      return row && row.createdAt.getTime() + REQUEST_TTL_MS > Date.now() ? row.createdAt.toISOString() : null;
    },
    async removeAsync() {
      return null;
    },
  };
}

/** Uses up a request; true only for the one caller that removed it. */
export async function consumeRequest(organizationId: number, id: string): Promise<boolean> {
  const gone = await privilegedDb
    .delete(ssoSamlRequests)
    .where(and(eq(ssoSamlRequests.id, id), eq(ssoSamlRequests.organizationId, organizationId)))
    .returning();
  return gone.length === 1;
}

export async function pruneRequests(now = Date.now()): Promise<void> {
  await privilegedDb.delete(ssoSamlRequests).where(lt(ssoSamlRequests.createdAt, new Date(now - REQUEST_TTL_MS)));
}

// ─── Talking to the provider ────────────────────────────────────────────────────

function samlFor(row: SamlRow, publicBase: string, purpose: 'authn' | 'logout' = 'authn', sessionId?: string): SAML {
  const { entityId, acsUrl, sloUrl } = spUrls(publicBase, row.organizationId);
  const privateKey = spPrivateKey(row);
  return new SAML({
    entryPoint: row.samlSsoUrl!,
    issuer: entityId,
    callbackUrl: acsUrl,
    audience: entityId,
    idpIssuer: row.issuer,
    idpCert: row.samlCertificate!,
    // The assertion carries the identity, so it is the part that must be signed; a signature on the
    // whole response alone (as some providers send) is accepted by node-saml as covering it.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    validateInResponseTo: purpose === 'authn' && row.samlAllowIdpInitiated ? ValidateInResponseTo.ifPresent : ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: row.samlAllowIdpInitiated ? REQUEST_TTL_MS : undefined,
    cacheProvider: cacheFor(row.organizationId, purpose, sessionId),
    ...(privateKey ? { privateKey, decryptionPvk: privateKey, publicCert: row.samlSpCertificate!, signatureAlgorithm: 'sha256' as const, digestAlgorithm: 'sha256' } : {}),
    ...(row.samlSloUrl ? { logoutUrl: row.samlSloUrl, logoutCallbackUrl: sloUrl } : {}),
  });
}

/** The URL to send the browser to, and the request id to bind to it. */
export async function startSamlSignIn(row: SamlRow, publicBase: string): Promise<{ url: string; requestId: string }> {
  await pruneRequests();
  const url = await samlFor(row, publicBase).getAuthorizeUrlAsync('', undefined, {});
  const encoded = new URL(url).searchParams.get('SAMLRequest');
  const requestId = encoded ? requestIdOf(encoded) : null;
  if (!requestId) throw new Error('Could not read back the AuthnRequest id.');
  return { url, requestId };
}

function requestIdOf(deflatedBase64: string): string | null {
  const xml = inflateRawSync(Buffer.from(deflatedBase64, 'base64')).toString('utf8');
  return /\sID="([^"]+)"/.exec(xml)?.[1] ?? null;
}

/** The request a posted Response says it answers, read before anything is trusted. */
export function inResponseToOf(samlResponse: string): string | null {
  try {
    const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
    const root = /<(?:\w+:)?Response\b[^>]*>/.exec(xml)?.[0] ?? '';
    return /\sInResponseTo="([^"]+)"/.exec(root)?.[1] ?? null;
  } catch {
    return null;
  }
}

const EMAIL_ATTRIBUTES = [
  'email',
  'mail',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];

const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The address the assertion vouches for: a mail attribute, or an address-shaped NameID. */
export function samlEmailOf(profile: Pick<Profile, 'nameID'> & Record<string, unknown>): string | null {
  for (const name of EMAIL_ATTRIBUTES) {
    const value = profile[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string' && ADDRESS.test(first.trim())) return first.trim().toLowerCase();
  }
  if (typeof profile.nameID === 'string' && ADDRESS.test(profile.nameID.trim())) return profile.nameID.trim().toLowerCase();
  return null;
}

/**
 * The stable identity of the person at the provider. A persistent or unspecified NameID is that
 * identity; a transient one changes at every sign-in, so the address stands in for it.
 */
export function samlSubjectOf(profile: Pick<Profile, 'nameID' | 'nameIDFormat'>, email: string): string {
  return /:transient$/.test(profile.nameIDFormat ?? '') ? `email:${email}` : profile.nameID;
}

export type SamlFailure =
  | { error: 'expired' }
  | { error: 'browser_mismatch' }
  | { error: 'provider_error'; detail: string }
  | { error: 'no_email' }
  | { error: 'domain_not_allowed' };

export interface SamlIdentity {
  issuer: string;
  subject: string;
  email: string;
  /** The groups attribute, for roles (shared/sso-roles.ts). */
  groups: string[];
  session: SamlSessionIdentity;
}

/**
 * Checks a posted Response for an organization. `boundRequestId` is the request named by the
 * browser's binding cookie: undefined when cookies are not Secure (plain-HTTP development), where
 * the binding cannot be set cross-site and is not required.
 */
export async function finishSamlSignIn(
  row: SamlRow,
  publicBase: string,
  samlResponse: string,
  boundRequestId: string | null | undefined,
): Promise<SamlIdentity | SamlFailure> {
  const inResponseTo = inResponseToOf(samlResponse);
  if (!inResponseTo && !row.samlAllowIdpInitiated) return { error: 'provider_error', detail: 'The response answers no request (InResponseTo is missing).' };
  if (inResponseTo && boundRequestId !== undefined && boundRequestId !== inResponseTo) return { error: 'browser_mismatch' };

  let profile: Profile | null;
  try {
    const responseRoot = readXml(Buffer.from(samlResponse, 'base64').toString('utf8'), 'Response', PROTOCOL_NS);
    if (responseRoot.getAttribute('Destination') !== spUrls(publicBase, row.organizationId).acsUrl) throw new Error('SAML response Destination does not match the ACS.');
    const assertionChildren = Array.from(responseRoot.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === ASSERTION_NS);
    if (row.samlRequireEncryptedAssertions && (assertionChildren.filter(node => node.localName === 'EncryptedAssertion').length !== 1 || assertionChildren.some(node => node.localName === 'Assertion'))) throw new Error('This provider requires one encrypted assertion and no plaintext assertion.');
    ({ profile } = await samlFor(row, publicBase).validatePostResponseAsync({ SAMLResponse: samlResponse }));
  } catch (error) {
    if (inResponseTo) await consumeRequest(row.organizationId, inResponseTo);
    const message = error instanceof Error ? error.message : String(error);
    if (/InResponseTo is not valid|SubjectInResponseTo is not valid/.test(message)) return { error: 'expired' };
    return { error: 'provider_error', detail: message };
  }
  if (!profile) return { error: 'provider_error', detail: 'The response carries no assertion.' };
  // node-saml compares idpIssuer only on logout responses, so the assertion's (signed) issuer is
  // checked here: a provider that signs for several tenants with one key must not sign in to ours.
  if (profile.issuer !== row.issuer) {
    if (inResponseTo) await consumeRequest(row.organizationId, inResponseTo);
    return { error: 'provider_error', detail: `The assertion was issued by "${profile.issuer}", not by "${row.issuer}".` };
  }
  // Valid, and answering a request we sent: now make sure nobody else used it in the meantime.
  try {
    const assertion = readXml(profile.getAssertionXml?.() ?? '', 'Assertion', ASSERTION_NS);
    const acsUrl = spUrls(publicBase, row.organizationId).acsUrl;
    const confirmations = Array.from(assertion.getElementsByTagNameNS(ASSERTION_NS, 'SubjectConfirmation'));
    const validBearer = confirmations.some(confirmation => {
      const data = confirmation.getElementsByTagNameNS(ASSERTION_NS, 'SubjectConfirmationData')[0];
      const expiry = Date.parse(data?.getAttribute('NotOnOrAfter') || '');
      const notBefore = data?.getAttribute('NotBefore');
      return confirmation.getAttribute('Method') === 'urn:oasis:names:tc:SAML:2.0:cm:bearer' && data?.getAttribute('Recipient') === acsUrl && Number.isFinite(expiry) && expiry + CLOCK_SKEW_MS > Date.now() && (!notBefore || (Number.isFinite(Date.parse(notBefore)) && Date.parse(notBefore) <= Date.now() + CLOCK_SKEW_MS)) && (inResponseTo ? data.getAttribute('InResponseTo') === inResponseTo : !data.getAttribute('InResponseTo'));
    });
    if (!validBearer) throw new Error('No signed bearer confirmation matches this ACS and request.');
    if (inResponseTo) {
      if (!(await consumeRequest(row.organizationId, inResponseTo))) return { error: 'expired' };
    } else {
      const conditions = assertion.getElementsByTagNameNS(ASSERTION_NS, 'Conditions')[0];
      const expiresAt = Date.parse(conditions?.getAttribute('NotOnOrAfter') || '');
      const issuedAt = Date.parse(assertion.getAttribute('IssueInstant') || '');
      const id = assertion.getAttribute('ID');
      if (!id || !Number.isFinite(expiresAt) || !Number.isFinite(issuedAt) || expiresAt + CLOCK_SKEW_MS <= Date.now() || issuedAt > Date.now() + CLOCK_SKEW_MS || issuedAt < Date.now() - REQUEST_TTL_MS - CLOCK_SKEW_MS) throw new Error('Unsolicited assertion needs an ID and bounded valid time conditions.');
      if (!await rememberMessage(row.organizationId, 'assertion', id, new Date(Math.min(expiresAt, issuedAt + REQUEST_TTL_MS) + CLOCK_SKEW_MS))) return { error: 'expired' };
    }
  } catch (error) { return { error: 'provider_error', detail: error instanceof Error ? error.message : String(error) }; }

  const email = samlEmailOf(profile);
  if (!email) return { error: 'no_email' };
  const [allowed] = await privilegedDb
    .select({ domain: ssoDomains.domain })
    .from(ssoDomains)
    .where(usableDomain(email.split('@')[1], row.organizationId));
  if (!allowed) return { error: 'domain_not_allowed' };
  return {
    issuer: profile.issuer || row.issuer,
    subject: samlSubjectOf(profile, email),
    email,
    groups: groupsOf(profile as unknown as Record<string, unknown>, row.groupAttribute),
    session: { organizationId: row.organizationId, issuer: profile.issuer, nameId: profile.nameID, nameIdFormat: profile.nameIDFormat || null, sessionIndex: profile.sessionIndex || null },
  };
}

/** The service provider's metadata, for the owner to give the identity provider. */
export function serviceProviderMetadata(row: SamlRow, publicBase: string): string {
  const xml = samlFor(row, publicBase).generateServiceProviderMetadata(row.samlSpCertificate ?? null, row.samlSpCertificate ?? null);
  // node-saml advertises POST only; the callback accepts signed POST and Redirect.
  return row.samlSloUrl ? xml.replace(/(<SingleLogoutService\b[^>]*Binding=")urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST("[^>]*\/>)/, `$1${REDIRECT_BINDING}$2$1urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST$2`) : xml;
}

function readXml(xml: string, rootName: string, namespace: string): Element {
  if (!xml || Buffer.byteLength(xml) > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid or oversized SAML XML.');
  let invalid = false;
  const doc = new DOMParser({ errorHandler: { warning: () => { invalid = true; }, error: () => { invalid = true; }, fatalError: () => { invalid = true; } } }).parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (invalid || !root || root.localName !== rootName || root.namespaceURI !== namespace) throw new Error(`Expected a SAML ${rootName}.`);
  return root as unknown as Element;
}

export function validSpKeyPair(privateKey: string, certificate: string): boolean {
  try {
    const key = createPrivateKey(privateKey);
    const cert = new X509Certificate(certificate);
    return key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048 && cert.checkPrivateKey(key) && new Date(cert.validTo).getTime() > Date.now();
  } catch { return false; }
}

function spPrivateKey(row: SamlRow): string | undefined {
  return row.samlSpPrivateKeyEncrypted && row.samlSpPrivateKeyIv && row.samlSpPrivateKeyAuthTag ? decryptSecret(row.samlSpPrivateKeyEncrypted, row.samlSpPrivateKeyIv, row.samlSpPrivateKeyAuthTag) : undefined;
}

async function rememberMessage(organizationId: number, purpose: string, id: string, expiresAt: Date): Promise<boolean> {
  await privilegedDb.delete(ssoSamlReplay).where(lt(ssoSamlReplay.expiresAt, new Date()));
  const hash = createHash('sha256').update(JSON.stringify([organizationId, purpose, id])).digest('hex');
  return (await privilegedDb.insert(ssoSamlReplay).values({ id: hash, organizationId, expiresAt }).onConflictDoNothing().returning()).length === 1;
}

export async function registerSamlSession(sessionId: string, userId: number, identity: SamlSessionIdentity): Promise<void> {
  await privilegedDb.insert(ssoSamlSessions).values({ sessionId, userId, ...identity }).onConflictDoUpdate({ target: ssoSamlSessions.sessionId, set: { userId, ...identity } });
}

export async function forgetSamlSession(sessionId: string): Promise<void> {
  await privilegedDb.delete(ssoSamlSessions).where(eq(ssoSamlSessions.sessionId, sessionId));
}

export async function isSamlSessionActive(sessionId: string, userId: number, organizationId: number): Promise<boolean> {
  return (await privilegedDb.select({ id: ssoSamlSessions.sessionId }).from(ssoSamlSessions).where(and(eq(ssoSamlSessions.sessionId, sessionId), eq(ssoSamlSessions.userId, userId), eq(ssoSamlSessions.organizationId, organizationId))).limit(1)).length === 1;
}

/** Called by ordinary logout before clearing Passport/session state. Local logout still works without SLO. */
export async function startSessionSamlLogout(req: Request, publicBase: string): Promise<{ url: string; requestId: string } | null> {
  const identity = req.session?.samlIdentity;
  if (!identity || !req.user || req.user.organizationId !== identity.organizationId) return null;
  const [row] = await privilegedDb.select().from(organizationSso).where(eq(organizationSso.organizationId, identity.organizationId));
  if (!row?.enabled || row.protocol !== 'saml' || !row.samlSloUrl || !spPrivateKey(row)) return null;
  const url = await samlFor(row, publicBase, 'logout', req.sessionID).getLogoutUrlAsync({ issuer: identity.issuer, nameID: identity.nameId, nameIDFormat: identity.nameIdFormat ?? undefined, sessionIndex: identity.sessionIndex ?? undefined } as Profile, '', {});
  const encoded = new URL(url).searchParams.get('SAMLRequest');
  const requestId = encoded ? requestIdOf(encoded) : null;
  if (!requestId) throw new Error('Could not read the LogoutRequest id.');
  return { url, requestId };
}

function signedPostLogoutRoot(xml: string, row: SamlRow, rootName: string): Element {
  const root = readXml(xml, rootName, PROTOCOL_NS);
  const signatures = Array.from(root.getElementsByTagNameNS(DS, 'Signature'));
  if (signatures.length !== 1 || signatures[0].parentNode !== root) throw new Error('SLO requires one root signature.');
  const algorithm = signatures[0].getElementsByTagNameNS(DS, 'SignatureMethod')[0]?.getAttribute('Algorithm');
  if (!['http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512'].includes(algorithm || '')) throw new Error('SLO requires an RSA SHA-256/512 signature.');
  const sig = new SignedXml({ publicCert: row.samlCertificate!, getCertFromKeyInfo: () => null });
  sig.loadSignature(signatures[0] as never);
  if (!sig.checkSignature(xml) || sig.getSignedReferences().length !== 1) throw new Error('Invalid SLO XML signature.');
  const verified = readXml(sig.getSignedReferences()[0], rootName, PROTOCOL_NS);
  if (!verified.getAttribute('ID') || verified.getAttribute('ID') !== root.getAttribute('ID')) throw new Error('Signature does not cover the SLO message.');
  return verified;
}

export async function finishSamlLogout(
  row: SamlRow, publicBase: string, req: Request,
): Promise<{ redirectUrl?: string; response: boolean; revoked: number }> {
  if (!row.samlSloUrl || !spPrivateKey(row)) throw new Error('Single logout is not configured.');
  const params = req.method === 'GET' ? req.query : req.body;
  const messageType = typeof params.SAMLRequest === 'string' ? 'SAMLRequest' : typeof params.SAMLResponse === 'string' ? 'SAMLResponse' : null;
  if (!messageType || (params.SAMLRequest && params.SAMLResponse) || params[messageType].length > 2_000_000) throw new Error('Supply one bounded SLO message.');
  const rootName = messageType === 'SAMLRequest' ? 'LogoutRequest' : 'LogoutResponse';
  const saml = samlFor(row, publicBase, 'logout');
  let root: Element;
  if (req.method === 'GET') {
    if (typeof params.Signature !== 'string' || typeof params.SigAlg !== 'string' || !['http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512'].includes(params.SigAlg)) throw new Error('Redirect SLO requires an RSA SHA-256/512 signature.');
    const query = req.originalUrl.split('?')[1] || '';
    const keys = query.split('&').map(token => decodeURIComponent(token.split('=')[0]));
    if (new Set(keys).size !== keys.length || keys.some(key => !['SAMLRequest', 'SAMLResponse', 'RelayState', 'SigAlg', 'Signature'].includes(key))) throw new Error('Duplicate or unsupported SLO query parameters.');
    root = readXml(inflateRawSync(Buffer.from(params[messageType], 'base64'), { maxOutputLength: 1_000_000 }).toString('utf8'), rootName, PROTOCOL_NS);
    await saml.validateRedirectAsync(params, query);
  } else {
    root = signedPostLogoutRoot(Buffer.from(params[messageType], 'base64').toString('utf8'), row, rootName);
  }
  const destination = spUrls(publicBase, row.organizationId).sloUrl;
  const issuedAt = Date.parse(root.getAttribute('IssueInstant') || '');
  const id = root.getAttribute('ID');
  if (root.getAttribute('Destination') !== destination || !id || !Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > REQUEST_TTL_MS) throw new Error('SLO destination, ID or time is invalid.');
  const issuer = root.getElementsByTagNameNS(ASSERTION_NS, 'Issuer')[0]?.textContent;
  if (issuer !== row.issuer) throw new Error('Wrong SLO issuer.');
  if (messageType === 'SAMLResponse') {
    const inResponseTo = root.getAttribute('InResponseTo');
    const status = root.getElementsByTagNameNS(PROTOCOL_NS, 'StatusCode')[0]?.getAttribute('Value');
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${SLO_BINDING_COOKIE}=`))?.slice(SLO_BINDING_COOKIE.length + 1);
    if (!inResponseTo || cookie !== encodeURIComponent(inResponseTo) || status !== 'urn:oasis:names:tc:SAML:2.0:status:Success') throw new Error('Uncorrelated or unsuccessful LogoutResponse.');
    const [pending] = await privilegedDb.select().from(ssoSamlRequests).where(and(eq(ssoSamlRequests.id, inResponseTo), eq(ssoSamlRequests.organizationId, row.organizationId), eq(ssoSamlRequests.purpose, 'logout')));
    if (!pending || pending.createdAt.getTime() + REQUEST_TTL_MS < Date.now() || !await consumeRequest(row.organizationId, inResponseTo)) throw new Error('Expired or replayed LogoutResponse.');
    return { response: true, revoked: 0 };
  }
  const name = root.getElementsByTagNameNS(ASSERTION_NS, 'NameID')[0];
  const indexes = Array.from(root.getElementsByTagNameNS(PROTOCOL_NS, 'SessionIndex'));
  if (!name?.textContent || indexes.length > 1) throw new Error('LogoutRequest requires one exact session identity.');
  if ((name.getAttribute('NameQualifier') && name.getAttribute('NameQualifier') !== row.issuer) || (name.getAttribute('SPNameQualifier') && name.getAttribute('SPNameQualifier') !== spUrls(publicBase, row.organizationId).entityId)) throw new Error('LogoutRequest NameID qualifiers do not match this provider.');
  const notOnOrAfter = root.getAttribute('NotOnOrAfter');
  if (notOnOrAfter && (!Number.isFinite(Date.parse(notOnOrAfter)) || Date.parse(notOnOrAfter) + CLOCK_SKEW_MS <= Date.now())) throw new Error('Expired LogoutRequest.');
  const nameIdFormat = name.getAttribute('Format') || null, sessionIndex = indexes[0]?.textContent || null;
  if (!await rememberMessage(row.organizationId, 'logout', id, new Date(issuedAt + REQUEST_TTL_MS + CLOCK_SKEW_MS))) throw new Error('Replayed LogoutRequest.');
  // SAML omitting SessionIndex logs out every session for this exact provider/NameID.
  const gone = await privilegedDb.delete(ssoSamlSessions).where(and(eq(ssoSamlSessions.organizationId, row.organizationId), eq(ssoSamlSessions.issuer, issuer), eq(ssoSamlSessions.nameId, name.textContent), nameIdFormat ? eq(ssoSamlSessions.nameIdFormat, nameIdFormat) : isNull(ssoSamlSessions.nameIdFormat), sessionIndex ? eq(ssoSamlSessions.sessionIndex, sessionIndex) : undefined)).returning();
  if (!gone.length) throw new Error('LogoutRequest matches no active SAML session.');
  await Promise.all(gone.map(session => new Promise<void>((resolve, reject) => req.sessionStore.destroy(session.sessionId, error => error ? reject(error) : resolve()))));
  const profile = { ID: id, issuer, nameID: name.textContent, nameIDFormat: nameIdFormat, sessionIndex } as Profile;
  const redirectUrl = await saml.getLogoutResponseUrlAsync(profile, '', {}, true);
  return { redirectUrl, response: false, revoked: gone.length };
}

/** For the owner's "Test" button: the certificate is usable and the sign-on URL answers. */
export async function testSamlProvider(row: SamlRow, doFetch: typeof fetch = fetch): Promise<{ ok: true; issuer: string } | { ok: false; message: string }> {
  const info = row.samlCertificate ? certificateInfo(row.samlCertificate) : null;
  if (!info) return { ok: false, message: 'The signing certificate cannot be read.' };
  if (info.expired) return { ok: false, message: `The provider's signing certificate expired on ${info.validTo.slice(0, 10)}: every sign-in would be refused. Paste the new one.` };
  try {
    const response = await doFetch(row.samlSsoUrl!, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status >= 500) return { ok: false, message: `The sign-on URL answered ${response.status}.` };
  } catch (error) {
    return { ok: false, message: `The sign-on URL could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, issuer: row.issuer };
}
