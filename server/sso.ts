import * as oidc from 'openid-client';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  auditLog,
  organizationSso,
  ssoDomains,
  ssoIdentities,
  users,
  type AuditAction,
  type User,
} from '@shared/schema';
import { privilegedDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import { sqlState } from './db-errors';
import { DEFAULT_GROUP_ATTRIBUTE, domainVerificationRecord, groupsOf, roleFromGroups, roleMappingSchema, type RoleMapping } from '@shared/sso-roles';
import { checkDomainRecord, domainVerificationRequired, newVerificationToken, usableDomain } from './sso-domains';
import type { AuditActor } from './audit';
import { reapplyGroupRoles } from './scim';
import {
  certificateInfo,
  finishSamlSignIn as checkSamlResponse,
  normaliseCertificate,
  startSamlSignIn,
  testSamlProvider,
  type CertificateInfo,
} from './sso-saml';

/**
 * Single sign-on, one identity provider per organization, speaking OpenID Connect or SAML 2.0.
 * This module owns the settings and the accounts; the SAML conversation is in server/sso-saml.ts.
 * What follows describes OpenID Connect; SAML differs only in how the identity is proven.
 *
 * An owner registers the application with their provider (Entra ID, Okta, Google Workspace,
 * Keycloak and the like) and enters here its issuer, the client id and secret, and the e-mail
 * domains it signs in. Signing in then goes:
 *
 * 1. The sign-in page asks for an e-mail address. Its domain names the organization, and so the
 *    provider (sso_domains: one organization per domain).
 * 2. The browser goes to the provider with PKCE, a state and a nonce kept in the session.
 * 3. The provider sends it back to /api/sso/callback; the code is exchanged, and the ID token's
 *    signature, issuer, audience, nonce and expiry are checked by openid-client.
 * 4. The identity (issuer and subject) finds the account. The first time, an account of the same
 *    organization whose username is that e-mail address is linked to it; failing that, one is
 *    created with the organization's default role — viewer or editor, never owner.
 *
 * The provider decides who gets in, and that includes people removed here: removing a member
 * deletes their account, and their next sign-in through the provider creates a new one. Access is
 * ended at the provider — at once when it provisions through SCIM (server/scim.ts), which
 * deactivates the account.
 *
 * Everything runs on the privileged handle, like server/mfa.ts: the provider for a domain has to
 * be found before anyone is signed in. Every statement names the organization it is about.
 */

export type SsoRole = 'viewer' | 'editor';
export const SSO_ROLES: readonly SsoRole[] = ['viewer', 'editor'];
export type SsoProtocol = 'oidc' | 'saml';
export const SSO_PROTOCOLS: readonly SsoProtocol[] = ['oidc', 'saml'];

/** What an owner sees. Never the secret. */
export interface SsoSettings {
  protocol: SsoProtocol;
  /** OpenID Connect: the issuer URL. SAML: the provider's entity ID. */
  issuer: string;
  clientId: string | null;
  samlSsoUrl: string | null;
  /** The SAML signing certificate as stored (it is public) and what it says. */
  samlCertificate: string | null;
  samlCertificateInfo: CertificateInfo | null;
  domains: string[];
  /** Each domain with its DNS proof (server/sso-domains.ts). */
  domainStatus: Array<{ domain: string; verified: boolean; verifiedAt: Date | null; record: { name: string; value: string } | null }>;
  /** Whether unproven domains are refused on this installation (SSO_REQUIRE_DOMAIN_VERIFICATION). */
  verificationRequired: boolean;
  defaultRole: SsoRole;
  enabled: boolean;
  required: boolean;
  groupAttribute: string;
  roleMappings: RoleMapping[];
  requireGroup: boolean;
  /** The provider's SCIM token (server/scim.ts), never the token itself. Null: no provisioning. */
  scimToken: { prefix: string; createdAt: Date | null; lastUsedAt: Date | null } | null;
  updatedAt: Date;
}

export interface SsoInput {
  protocol?: SsoProtocol;
  issuer: string;
  clientId?: string;
  /** Empty or absent keeps the stored one. */
  clientSecret?: string;
  samlSsoUrl?: string;
  samlCertificate?: string;
  domains: string[];
  defaultRole: SsoRole;
  enabled: boolean;
  required: boolean;
  /** Absent keeps the stored value. */
  groupAttribute?: string | null;
  roleMappings?: RoleMapping[];
  requireGroup?: boolean;
}

/** What a sign-in in progress keeps in the session between leaving for the provider and coming back. */
export interface SsoPending {
  organizationId: number;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
}

declare module 'express-session' {
  interface SessionData {
    ssoPending?: SsoPending;
    /** 'sso' when this session was opened through the organization's identity provider. */
    signedInWith?: 'sso';
  }
}

/** How long the provider has to send the browser back. */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Discovery documents and keys, per organization, before asking the provider again. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

type SsoError =
  | 'invalid_issuer'
  | 'client_id_required'
  | 'invalid_sso_url'
  | 'invalid_certificate'
  | 'invalid_domain'
  | 'secret_required'
  | 'domain_taken'
  | 'required_needs_enabled'
  | 'invalid_mapping'
  | 'require_group_needs_mappings';

export class SsoConfigError extends Error {
  constructor(readonly code: SsoError, message: string) {
    super(message);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────────

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normaliseDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

export function validIssuer(value: string, env: NodeJS.ProcessEnv = process.env): URL | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.search || url.hash || url.username || url.password) return null;
  // Plain HTTP only outside production, for a provider on a developer's machine.
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && env.NODE_ENV !== 'production') return url;
  return null;
}

// ─── Settings ───────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];

async function audit(tx: Tx, organizationId: number, actor: AuditActor, action: AuditAction, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
  await tx.insert(auditLog).values({
    organizationId,
    actorUserId: actor.id,
    actorUsername: actor.username,
    apiKeyId: actor.apiKeyId ?? null,
    ipAddress: actor.ipAddress ?? null,
    action,
    targetType,
    targetId,
    metadata: metadata ?? null,
  });
}

export async function getSsoSettings(organizationId: number): Promise<SsoSettings | null> {
  const [row] = await privilegedDb.select().from(organizationSso).where(eq(organizationSso.organizationId, organizationId));
  if (!row) return null;
  const domains = await privilegedDb
    .select({ domain: ssoDomains.domain, token: ssoDomains.verificationToken, verifiedAt: ssoDomains.verifiedAt })
    .from(ssoDomains)
    .where(eq(ssoDomains.organizationId, organizationId))
    .orderBy(ssoDomains.domain);
  return {
    protocol: row.protocol as SsoProtocol,
    issuer: row.issuer,
    clientId: row.clientId,
    samlSsoUrl: row.samlSsoUrl,
    samlCertificate: row.samlCertificate,
    samlCertificateInfo: row.samlCertificate ? certificateInfo(row.samlCertificate) : null,
    domains: domains.map((d) => d.domain),
    domainStatus: domains.map((d) => ({
      domain: d.domain,
      verified: d.verifiedAt !== null,
      verifiedAt: d.verifiedAt,
      record: d.token ? domainVerificationRecord(d.domain, d.token) : null,
    })),
    verificationRequired: domainVerificationRequired(),
    defaultRole: row.defaultRole as SsoRole,
    enabled: row.enabled,
    required: row.required,
    groupAttribute: row.groupAttribute ?? DEFAULT_GROUP_ATTRIBUTE,
    roleMappings: row.roleMappings ?? [],
    requireGroup: row.requireGroup,
    scimToken: row.scimTokenPrefix ? { prefix: row.scimTokenPrefix, createdAt: row.scimTokenCreatedAt, lastUsedAt: row.scimTokenLastUsedAt } : null,
    updatedAt: row.updatedAt,
  };
}

export async function saveSsoSettings(organizationId: number, actor: AuditActor, input: SsoInput): Promise<SsoSettings> {
  const protocol: SsoProtocol = input.protocol ?? 'oidc';
  let samlCertificate: string | null = null;
  let samlSsoUrl: string | null = null;
  if (protocol === 'oidc') {
    if (!validIssuer(input.issuer)) {
      throw new SsoConfigError('invalid_issuer', 'The issuer must be the provider\'s https address, as its discovery document states it.');
    }
    if (!input.clientId?.trim()) throw new SsoConfigError('client_id_required', 'Enter the client ID.');
  } else {
    // An entity ID is a URI or a URN, as the provider's metadata states it; it is compared, not fetched.
    if (!input.issuer.trim() || /\s/.test(input.issuer.trim())) {
      throw new SsoConfigError('invalid_issuer', 'Enter the provider\'s entity ID, as its metadata states it (entityID).');
    }
    if (!input.samlSsoUrl || !validIssuer(input.samlSsoUrl.split('?')[0])) {
      throw new SsoConfigError('invalid_sso_url', 'The sign-on URL must be the provider\'s https address for the HTTP-Redirect binding.');
    }
    samlSsoUrl = input.samlSsoUrl.trim();
    samlCertificate = input.samlCertificate ? normaliseCertificate(input.samlCertificate) : null;
    if (!samlCertificate) {
      throw new SsoConfigError('invalid_certificate', 'Paste the provider\'s signing certificate (X.509, PEM or base64).');
    }
    if (certificateInfo(samlCertificate)!.expired) {
      throw new SsoConfigError('invalid_certificate', 'That certificate has expired: every sign-in would be refused. Paste the provider\'s current one.');
    }
  }
  const domains = [...new Set(input.domains.map(normaliseDomain).filter((d) => d !== ''))];
  const invalid = domains.filter((d) => !DOMAIN.test(d));
  if (domains.length === 0 || invalid.length > 0) {
    throw new SsoConfigError('invalid_domain', invalid.length > 0 ? `Not an e-mail domain: ${invalid.join(', ')}.` : 'Name at least one e-mail domain.');
  }
  if (input.required && !input.enabled) {
    throw new SsoConfigError('required_needs_enabled', 'Single sign-on can only be required while it is on.');
  }
  const mappingsGiven = input.roleMappings !== undefined;
  const mappings: RoleMapping[] = [];
  for (const raw of input.roleMappings ?? []) {
    const parsed = roleMappingSchema.safeParse(raw);
    if (!parsed.success) throw new SsoConfigError('invalid_mapping', 'Each mapping needs a group and a role (viewer, editor or owner).');
    if (mappings.some((m) => m.group.toLowerCase() === parsed.data.group.toLowerCase())) {
      throw new SsoConfigError('invalid_mapping', `The group "${parsed.data.group}" is mapped twice.`);
    }
    mappings.push(parsed.data);
  }
  const groupAttribute = input.groupAttribute === undefined ? undefined : input.groupAttribute?.trim() || null;
  if (groupAttribute && (groupAttribute.length > 200 || /\s/.test(groupAttribute))) {
    throw new SsoConfigError('invalid_mapping', 'The group claim or attribute is one name, without spaces.');
  }
  const secret = input.clientSecret?.trim() ?? '';

  try {
    await privilegedDb.transaction(async (tx) => {
      const [existing] = await tx
        .select({ organizationId: organizationSso.organizationId })
        .from(organizationSso)
        .where(eq(organizationSso.organizationId, organizationId));
      if (protocol === 'oidc' && !secret) {
        const [stored] = existing
          ? await tx.select({ secret: organizationSso.clientSecretEncrypted }).from(organizationSso).where(eq(organizationSso.organizationId, organizationId))
          : [];
        if (!stored?.secret) throw new SsoConfigError('secret_required', 'Enter the client secret.');
      }

      const taken = await tx
        .select({ domain: ssoDomains.domain, verifiedAt: ssoDomains.verifiedAt })
        .from(ssoDomains)
        .where(and(inArray(ssoDomains.domain, domains), ne(ssoDomains.organizationId, organizationId)));
      // Where proof is required, only a proven claim keeps a domain; an unproven one is released.
      const blocking = domainVerificationRequired() ? taken.filter((t) => t.verifiedAt !== null) : taken;
      if (blocking.length > 0) {
        throw new SsoConfigError('domain_taken', `Another organization on this installation signs in ${blocking.map((t) => t.domain).join(', ')}.`);
      }
      const released = taken.map((t) => t.domain);
      if (released.length > 0) await tx.delete(ssoDomains).where(inArray(ssoDomains.domain, released));

      const values = {
        protocol,
        // As typed: openid-client compares it with the discovery document's after normalising both.
        issuer: input.issuer.trim(),
        defaultRole: input.defaultRole,
        enabled: input.enabled,
        required: input.required,
        ...(mappingsGiven ? { roleMappings: mappings } : {}),
        ...(groupAttribute !== undefined ? { groupAttribute } : {}),
        ...(input.requireGroup !== undefined ? { requireGroup: input.requireGroup } : {}),
        updatedAt: new Date(),
        ...(protocol === 'oidc'
          ? { clientId: input.clientId!.trim(), samlSsoUrl: null, samlCertificate: null, ...(secret ? secretColumns(secret) : {}) }
          : { samlSsoUrl, samlCertificate, clientId: null, clientSecretEncrypted: null, clientSecretIv: null, clientSecretAuthTag: null }),
      };
      if (existing) {
        await tx.update(organizationSso).set(values).where(eq(organizationSso.organizationId, organizationId));
      } else {
        await tx.insert(organizationSso).values({ organizationId, ...values });
      }
      const [saved] = await tx
        .select({ roleMappings: organizationSso.roleMappings, requireGroup: organizationSso.requireGroup })
        .from(organizationSso)
        .where(eq(organizationSso.organizationId, organizationId));
      if (saved.requireGroup && (saved.roleMappings ?? []).length === 0) {
        throw new SsoConfigError('require_group_needs_mappings', 'Map at least one group before refusing people who are in none.');
      }
      // Domains kept keep their proof; only the ones removed go, and new ones get a token.
      const kept = await tx.select({ domain: ssoDomains.domain }).from(ssoDomains).where(eq(ssoDomains.organizationId, organizationId));
      const removed = kept.map((k) => k.domain).filter((d) => !domains.includes(d));
      if (removed.length > 0) await tx.delete(ssoDomains).where(and(eq(ssoDomains.organizationId, organizationId), inArray(ssoDomains.domain, removed)));
      const added = domains.filter((d) => !kept.some((k) => k.domain === d));
      if (added.length > 0) {
        await tx.insert(ssoDomains).values(added.map((domain) => ({ domain, organizationId, verificationToken: newVerificationToken() })));
      }

      await audit(tx, organizationId, actor, AUDIT_ACTIONS.SSO_CONFIGURED, 'organization', String(organizationId), {
        protocol,
        issuer: values.issuer,
        clientId: values.clientId,
        ...(protocol === 'saml' ? { samlSsoUrl, certificateFingerprint: certificateInfo(samlCertificate!)!.fingerprint256 } : {}),
        domains,
        defaultRole: input.defaultRole,
        enabled: input.enabled,
        required: input.required,
        secretChanged: protocol === 'oidc' && Boolean(secret),
        roleMappings: saved.roleMappings,
        requireGroup: saved.requireGroup,
        ...(released.length > 0 ? { takenFromUnverifiedClaims: released } : {}),
      });
    });
  } catch (error) {
    // Two organizations claiming one domain at the same moment: the primary key decides.
    if (sqlState(error) === '23505') {
      throw new SsoConfigError('domain_taken', 'Another organization on this installation signs in one of these domains.');
    }
    throw error;
  }
  forgetDiscovery(organizationId);
  // New mappings apply to the groups the provider pushes through SCIM at once, not at the next change.
  if (mappingsGiven) await reapplyGroupRoles(organizationId, actor.ipAddress ?? null);
  return (await getSsoSettings(organizationId))!;
}

function secretColumns(secret: string) {
  const { encryptedValue, iv, authTag } = encryptSecret(secret);
  return { clientSecretEncrypted: encryptedValue, clientSecretIv: iv, clientSecretAuthTag: authTag };
}

/**
 * Looks for the domain's TXT record and, when it carries the token, marks the domain proven.
 * The owner's "Verify" button.
 */
export async function verifySsoDomain(
  organizationId: number,
  actor: AuditActor,
  domain: string,
): Promise<{ verified: true } | { verified: false; message: string } | null> {
  const name = normaliseDomain(domain);
  const [row] = await privilegedDb
    .select()
    .from(ssoDomains)
    .where(and(eq(ssoDomains.domain, name), eq(ssoDomains.organizationId, organizationId)));
  if (!row) return null;
  if (row.verifiedAt) return { verified: true };
  const token = row.verificationToken ?? newVerificationToken();
  if (!row.verificationToken) await privilegedDb.update(ssoDomains).set({ verificationToken: token }).where(eq(ssoDomains.domain, name));
  const problem = await checkDomainRecord(name, token);
  if (problem) return { verified: false, message: problem };
  await privilegedDb.transaction(async (tx) => {
    await tx.update(ssoDomains).set({ verifiedAt: new Date() }).where(and(eq(ssoDomains.domain, name), eq(ssoDomains.organizationId, organizationId)));
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.SSO_DOMAIN_VERIFIED, 'organization', String(organizationId), { domain: name });
  });
  return { verified: true };
}

/** Removes the provider and its domains. The links between accounts and identities stay, for a provider set up again. */
export async function removeSsoSettings(organizationId: number, actor: AuditActor): Promise<boolean> {
  const removed = await privilegedDb.transaction(async (tx) => {
    const gone = await tx.delete(organizationSso).where(eq(organizationSso.organizationId, organizationId)).returning();
    if (gone.length === 0) return false;
    await tx.delete(ssoDomains).where(eq(ssoDomains.organizationId, organizationId));
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.SSO_REMOVED, 'organization', String(organizationId));
    return true;
  });
  forgetDiscovery(organizationId);
  return removed;
}

// ─── Talking to the provider ────────────────────────────────────────────────────

const discoveries = new Map<number, { key: string; at: number; config: Promise<oidc.Configuration> }>();

function forgetDiscovery(organizationId: number) {
  discoveries.delete(organizationId);
}

/** Only for tests: a provider that restarted with new keys must be asked again. */
export function clearDiscoveryCache() {
  discoveries.clear();
}

async function providerRow(organizationId: number) {
  const [row] = await privilegedDb.select().from(organizationSso).where(eq(organizationSso.organizationId, organizationId));
  return row;
}

function clientFor(row: typeof organizationSso.$inferSelect): Promise<oidc.Configuration> {
  const key = `${row.issuer}|${row.clientId}|${row.updatedAt.getTime()}`;
  const cached = discoveries.get(row.organizationId);
  if (cached && cached.key === key && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.config;

  const issuer = new URL(row.issuer);
  const secret = decryptSecret(row.clientSecretEncrypted!, row.clientSecretIv!, row.clientSecretAuthTag!);
  const config = oidc.discovery(issuer, row.clientId!, undefined, oidc.ClientSecretBasic(secret), {
    timeout: 10,
    ...(issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : {}),
  });
  discoveries.set(row.organizationId, { key, at: Date.now(), config });
  // A provider that could not be reached is asked again next time, not in an hour.
  config.catch(() => {
    if (discoveries.get(row.organizationId)?.config === config) discoveries.delete(row.organizationId);
  });
  return config;
}

/** Whether the saved provider answers its discovery document. The owner's "Test" button. */
export async function testSsoProvider(organizationId: number): Promise<{ ok: true; issuer: string } | { ok: false; message: string }> {
  const row = await providerRow(organizationId);
  if (!row) return { ok: false, message: 'Single sign-on is not set up.' };
  if (row.protocol === 'saml') return testSamlProvider(row);
  forgetDiscovery(organizationId);
  try {
    const config = await clientFor(row);
    return { ok: true, issuer: config.serverMetadata().issuer };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${message}${cause}`;
}

// ─── Signing in ─────────────────────────────────────────────────────────────────

/** Whether any organization offers single sign-on: the sign-in page shows the button only then. */
export async function ssoAvailable(): Promise<boolean> {
  const [row] = await privilegedDb
    .select({ id: organizationSso.organizationId })
    .from(organizationSso)
    .where(eq(organizationSso.enabled, true))
    .limit(1);
  return row !== undefined;
}

export type SignInError =
  | 'unknown_domain'
  | 'provider_unreachable'
  | 'expired'
  | 'provider_error'
  | 'no_email'
  | 'email_unverified'
  | 'domain_not_allowed'
  | 'account_elsewhere'
  | 'account_disabled'
  | 'account_linked'
  | 'browser_mismatch'
  | 'no_group';

/**
 * Where to send the browser for an e-mail address, and what to remember until it comes back: a
 * pending sign-in in the session for OpenID Connect, a request id to bind to the browser for SAML.
 */
export async function beginSignIn(
  email: string,
  redirectUri: string,
): Promise<{ url: URL; pending?: SsoPending; samlRequestId?: string } | { error: SignInError; detail?: string }> {
  const domain = normaliseDomain(email.split('@').pop() ?? '');
  if (!email.includes('@') || !DOMAIN.test(domain)) return { error: 'unknown_domain' };
  const [match] = await privilegedDb
    .select({ organizationId: ssoDomains.organizationId })
    .from(ssoDomains)
    .innerJoin(organizationSso, eq(organizationSso.organizationId, ssoDomains.organizationId))
    .where(and(usableDomain(domain), eq(organizationSso.enabled, true)));
  if (!match) return { error: 'unknown_domain' };

  const row = await providerRow(match.organizationId);
  if (!row) return { error: 'unknown_domain' };
  if (row.protocol === 'saml') {
    try {
      const started = await startSamlSignIn(row, publicBaseOf(redirectUri));
      return { url: new URL(started.url), samlRequestId: started.requestId };
    } catch (error) {
      return { error: 'provider_unreachable', detail: describe(error) };
    }
  }
  let config: oidc.Configuration;
  try {
    config = await clientFor(row);
  } catch (error) {
    return { error: 'provider_unreachable', detail: describe(error) };
  }

  const codeVerifier = oidc.randomPKCECodeVerifier();
  const pending: SsoPending = {
    organizationId: match.organizationId,
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    codeVerifier,
    redirectUri,
    expiresAt: Date.now() + PENDING_TTL_MS,
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state: pending.state,
    nonce: pending.nonce,
    login_hint: email.trim(),
  });
  return { url, pending };
}

export interface SignedIn {
  user: User;
  /** A new account, created with the organization's default role. */
  created: boolean;
  /** An existing account, linked to this identity for the first time. */
  linked: boolean;
}

/**
 * The provider sent the browser back: exchange the code, check the ID token, find or create the
 * account. `currentUrl` is the callback URL as the browser requested it.
 */
export async function finishSignIn(
  pending: SsoPending | undefined,
  currentUrl: URL,
): Promise<SignedIn | { error: SignInError; detail?: string; organizationId?: number }> {
  if (!pending || pending.expiresAt < Date.now()) return { error: 'expired' };
  const row = await providerRow(pending.organizationId);
  if (!row || !row.enabled) return { error: 'expired' };

  let claims: oidc.IDToken;
  try {
    const config = await clientFor(row);
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims()!;
  } catch (error) {
    return { error: 'provider_error', detail: describe(error), organizationId: pending.organizationId };
  }

  const email = emailOf(claims);
  if (!email) return { error: 'no_email', organizationId: pending.organizationId };
  // Absent is accepted: Entra ID never sends it, and the domain check below still applies.
  if (claims.email_verified === false) return { error: 'email_unverified', organizationId: pending.organizationId };

  const domain = email.split('@')[1];
  const [allowed] = await privilegedDb
    .select({ domain: ssoDomains.domain })
    .from(ssoDomains)
    .where(usableDomain(domain, pending.organizationId));
  if (!allowed) return { error: 'domain_not_allowed', organizationId: pending.organizationId };

  const identity = { issuer: claims.iss, subject: claims.sub };
  const groups = groupsOf(claims as Record<string, unknown>, row.groupAttribute);
  try {
    return await resolveAccount(pending.organizationId, identity, email, row, groups);
  } catch (error) {
    // Two first sign-ins of one person at once: the second finds what the first created.
    if (sqlState(error) === '23505') return resolveAccount(pending.organizationId, identity, email, row, groups);
    throw error;
  }
}

/** The installation's public address, from the OpenID Connect callback built on it. */
function publicBaseOf(redirectUri: string): string {
  return redirectUri.replace(/\/api\/sso\/callback$/, '');
}

/**
 * The provider POSTed a SAML response to an organization's ACS: check it (server/sso-saml.ts) and find
 * or create the account, exactly as for OpenID Connect.
 */
export async function finishSamlSignIn(
  organizationId: number,
  publicBase: string,
  samlResponse: string,
  boundRequestId: string | null | undefined,
): Promise<SignedIn | { error: SignInError; detail?: string; organizationId?: number }> {
  const row = await providerRow(organizationId);
  if (!row || !row.enabled || row.protocol !== 'saml') return { error: 'expired' };
  const result = await checkSamlResponse(row, publicBase, samlResponse, boundRequestId);
  if ('error' in result) return { ...result, organizationId };
  const identity = { issuer: result.issuer, subject: result.subject };
  try {
    return await resolveAccount(organizationId, identity, result.email, row, result.groups);
  } catch (error) {
    if (sqlState(error) === '23505') return resolveAccount(organizationId, identity, result.email, row, result.groups);
    throw error;
  }
}

/** The SAML provider's row, for its metadata and ACS. Null when the organization does not use SAML. */
export async function samlProviderOf(organizationId: number) {
  const row = await providerRow(organizationId);
  return row && row.protocol === 'saml' ? row : null;
}

/** The address the token vouches for: `email`, or an address-shaped `preferred_username` (Entra ID's UPN). */
export function emailOf(claims: Record<string, unknown>): string | null {
  for (const candidate of [claims.email, claims.preferred_username]) {
    if (typeof candidate === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate.trim())) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

/** A password nobody knows: the column requires one, and comparePasswords must find it well formed. */
function unusablePassword(): string {
  return `${randomBytes(64).toString('hex')}.${randomBytes(16).toString('hex')}`;
}

/**
 * The role the provider's groups give, when the organization maps groups: the highest mapped role,
 * null when none of the person's groups is mapped (or nothing is mapped at all).
 */
function mappedRoleOf(provider: Pick<typeof organizationSso.$inferSelect, 'roleMappings'>, groups: string[]) {
  const mappings = provider.roleMappings ?? [];
  return mappings.length > 0 ? roleFromGroups(groups, mappings) : null;
}

async function resolveAccount(
  organizationId: number,
  identity: { issuer: string; subject: string },
  email: string,
  provider: Pick<typeof organizationSso.$inferSelect, 'defaultRole' | 'roleMappings' | 'requireGroup'>,
  groups: string[],
): Promise<SignedIn | { error: SignInError; organizationId: number }> {
  const mapped = mappedRoleOf(provider, groups);
  if (mapped === null && provider.requireGroup && (provider.roleMappings ?? []).length > 0) {
    return { error: 'no_group', organizationId };
  }
  const defaultRole = (mapped ?? provider.defaultRole) as User['role'];
  return privilegedDb.transaction(async (tx) => {
    const refuse = (error: SignInError) => ({ error, organizationId });
    const usable = (user: User) => user.kind === 'person' && !user.disabledAt;
    /**
     * The role the groups say, applied to an existing account at each sign-in. The organization's
     * last owner is never demoted this way: a provider group renamed must not lock everyone out.
     */
    const followGroups = async (user: User): Promise<User> => {
      if (mapped === null || user.role === mapped) return user;
      if (user.role === 'owner') {
        const [{ others }] = await tx
          .select({ others: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.organizationId, organizationId), eq(users.role, 'owner'), ne(users.id, user.id), sql`${users.disabledAt} IS NULL`));
        if (others === 0) return user;
      }
      const [updated] = await tx.update(users).set({ role: mapped }).where(eq(users.id, user.id)).returning();
      await audit(tx, organizationId, { id: user.id, username: user.username, ipAddress: null }, AUDIT_ACTIONS.MEMBER_ROLE_CHANGED, 'user', String(user.id), {
        username: user.username,
        from: user.role,
        to: mapped,
        bySsoGroups: true,
      });
      return updated;
    };

    const [known] = await tx
      .select({ userId: ssoIdentities.userId })
      .from(ssoIdentities)
      .where(and(eq(ssoIdentities.issuer, identity.issuer), eq(ssoIdentities.subject, identity.subject)));
    if (known) {
      const [user] = await tx.select().from(users).where(eq(users.id, known.userId));
      if (!user || user.organizationId !== organizationId) return refuse('account_elsewhere');
      if (!usable(user)) return refuse('account_disabled');
      await tx
        .update(ssoIdentities)
        .set({ lastSignInAt: new Date() })
        .where(and(eq(ssoIdentities.issuer, identity.issuer), eq(ssoIdentities.subject, identity.subject)));
      return { user: await followGroups(user), created: false, linked: false };
    }

    // First sign-in of this identity. Usernames are unique across the installation, so the
    // address may already be somebody's account: in this organization it is linked, anywhere else
    // it is not ours to give.
    const [existing] = await tx.select().from(users).where(sql`lower(${users.username}) = ${email}`).limit(1);
    if (existing) {
      if (existing.organizationId !== organizationId) return refuse('account_elsewhere');
      if (!usable(existing)) return refuse('account_disabled');
      const [alreadyLinked] = await tx.select({ issuer: ssoIdentities.issuer }).from(ssoIdentities).where(eq(ssoIdentities.userId, existing.id));
      if (alreadyLinked) return refuse('account_linked');
      await tx.insert(ssoIdentities).values({ ...identity, userId: existing.id });
      return { user: await followGroups(existing), created: false, linked: true };
    }

    const [user] = await tx
      .insert(users)
      .values({ username: email, password: unusablePassword(), organizationId, role: defaultRole, kind: 'person' })
      .returning();
    await tx.insert(ssoIdentities).values({ ...identity, userId: user.id });
    await audit(tx, organizationId, { id: user.id, username: user.username, ipAddress: null }, AUDIT_ACTIONS.MEMBER_PROVISIONED, 'user', String(user.id), {
      role: defaultRole,
      issuer: identity.issuer,
      ...(mapped ? { bySsoGroups: true } : {}),
    });
    return { user, created: true, linked: false };
  });
}

// ─── Requiring it ───────────────────────────────────────────────────────────────

/**
 * Whether this person must sign in through the provider. Owners never must: they are the way back
 * in when the provider is misconfigured or down.
 */
export async function ssoRequiredFor(user: Pick<User, 'role' | 'organizationId' | 'kind'>): Promise<boolean> {
  if (user.role === 'owner' || user.kind !== 'person') return false;
  const [row] = await privilegedDb
    .select({ required: organizationSso.required, enabled: organizationSso.enabled })
    .from(organizationSso)
    .where(eq(organizationSso.organizationId, user.organizationId));
  return Boolean(row?.enabled && row.required);
}

/** Whether an account has been linked to an identity at a provider. */
export async function hasSsoIdentity(userId: number): Promise<boolean> {
  const [row] = await privilegedDb.select({ userId: ssoIdentities.userId }).from(ssoIdentities).where(eq(ssoIdentities.userId, userId));
  return row !== undefined;
}
