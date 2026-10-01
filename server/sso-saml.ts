import { X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { and, eq, lt } from 'drizzle-orm';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';
import { organizationSso, ssoDomains, ssoSamlRequests } from '@shared/schema';
import { privilegedDb } from './db';

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

export type SamlRow = Pick<typeof organizationSso.$inferSelect, 'organizationId' | 'issuer' | 'samlSsoUrl' | 'samlCertificate'>;

// ─── The service provider's addresses ───────────────────────────────────────────

export function spUrls(publicBase: string, organizationId: number) {
  const root = `${publicBase.replace(/\/+$/, '')}/api/sso/saml/${organizationId}`;
  return { entityId: root, acsUrl: `${root}/acs`, metadataUrl: `${root}/metadata` };
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
  return { entityId, ssoUrl: redirect.getAttribute('Location') ?? '', certificate };
}

// ─── Pending requests ───────────────────────────────────────────────────────────

/**
 * Where node-saml keeps the requests it sent. Saving is real; getting tells it whether a request is
 * known; removing is left to consumeRequest, which deletes atomically after a response succeeds —
 * node-saml reads an id twice while validating, so deleting on its first read would refuse every
 * valid response.
 */
function cacheFor(organizationId: number): CacheProvider {
  return {
    async saveAsync(key, value) {
      await privilegedDb.insert(ssoSamlRequests).values({ id: key, organizationId }).onConflictDoNothing();
      return { value, createdAt: Date.now() };
    },
    async getAsync(key) {
      const [row] = await privilegedDb
        .select({ createdAt: ssoSamlRequests.createdAt })
        .from(ssoSamlRequests)
        .where(and(eq(ssoSamlRequests.id, key), eq(ssoSamlRequests.organizationId, organizationId)));
      return row ? row.createdAt.toISOString() : null;
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

function samlFor(row: SamlRow, publicBase: string): SAML {
  const { entityId, acsUrl } = spUrls(publicBase, row.organizationId);
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
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    acceptedClockSkewMs: 2 * 60 * 1000,
    cacheProvider: cacheFor(row.organizationId),
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
  if (!inResponseTo) return { error: 'provider_error', detail: 'The response answers no request (InResponseTo is missing).' };
  if (boundRequestId !== undefined && boundRequestId !== inResponseTo) return { error: 'browser_mismatch' };

  let profile: Profile | null;
  try {
    ({ profile } = await samlFor(row, publicBase).validatePostResponseAsync({ SAMLResponse: samlResponse }));
  } catch (error) {
    await consumeRequest(row.organizationId, inResponseTo);
    const message = error instanceof Error ? error.message : String(error);
    if (/InResponseTo is not valid|SubjectInResponseTo is not valid/.test(message)) return { error: 'expired' };
    return { error: 'provider_error', detail: message };
  }
  if (!profile) return { error: 'provider_error', detail: 'The response carries no assertion.' };
  // node-saml compares idpIssuer only on logout responses, so the assertion's (signed) issuer is
  // checked here: a provider that signs for several tenants with one key must not sign in to ours.
  if (profile.issuer !== row.issuer) {
    await consumeRequest(row.organizationId, inResponseTo);
    return { error: 'provider_error', detail: `The assertion was issued by "${profile.issuer}", not by "${row.issuer}".` };
  }
  // Valid, and answering a request we sent: now make sure nobody else used it in the meantime.
  if (!(await consumeRequest(row.organizationId, inResponseTo))) return { error: 'expired' };

  const email = samlEmailOf(profile);
  if (!email) return { error: 'no_email' };
  const [allowed] = await privilegedDb
    .select({ domain: ssoDomains.domain })
    .from(ssoDomains)
    .where(and(eq(ssoDomains.domain, email.split('@')[1]), eq(ssoDomains.organizationId, row.organizationId)));
  if (!allowed) return { error: 'domain_not_allowed' };
  return { issuer: profile.issuer || row.issuer, subject: samlSubjectOf(profile, email), email };
}

/** The service provider's metadata, for the owner to give the identity provider. */
export function serviceProviderMetadata(row: SamlRow, publicBase: string): string {
  return samlFor(row, publicBase).generateServiceProviderMetadata(null, null);
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
