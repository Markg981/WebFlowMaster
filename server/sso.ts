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
import type { AuditActor } from './audit';

/**
 * Single sign-on with OpenID Connect, one identity provider per organization.
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
 * ended at the provider.
 *
 * Everything runs on the privileged handle, like server/mfa.ts: the provider for a domain has to
 * be found before anyone is signed in. Every statement names the organization it is about.
 */

export type SsoRole = 'viewer' | 'editor';
export const SSO_ROLES: readonly SsoRole[] = ['viewer', 'editor'];

/** What an owner sees. Never the secret. */
export interface SsoSettings {
  issuer: string;
  clientId: string;
  domains: string[];
  defaultRole: SsoRole;
  enabled: boolean;
  required: boolean;
  updatedAt: Date;
}

export interface SsoInput {
  issuer: string;
  clientId: string;
  /** Empty or absent keeps the stored one. */
  clientSecret?: string;
  domains: string[];
  defaultRole: SsoRole;
  enabled: boolean;
  required: boolean;
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
  | 'invalid_domain'
  | 'secret_required'
  | 'domain_taken'
  | 'required_needs_enabled';

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
    .select({ domain: ssoDomains.domain })
    .from(ssoDomains)
    .where(eq(ssoDomains.organizationId, organizationId))
    .orderBy(ssoDomains.domain);
  return {
    issuer: row.issuer,
    clientId: row.clientId,
    domains: domains.map((d) => d.domain),
    defaultRole: row.defaultRole as SsoRole,
    enabled: row.enabled,
    required: row.required,
    updatedAt: row.updatedAt,
  };
}

export async function saveSsoSettings(organizationId: number, actor: AuditActor, input: SsoInput): Promise<SsoSettings> {
  const issuer = validIssuer(input.issuer);
  if (!issuer) {
    throw new SsoConfigError('invalid_issuer', 'The issuer must be the provider\'s https address, as its discovery document states it.');
  }
  const domains = [...new Set(input.domains.map(normaliseDomain).filter((d) => d !== ''))];
  const invalid = domains.filter((d) => !DOMAIN.test(d));
  if (domains.length === 0 || invalid.length > 0) {
    throw new SsoConfigError('invalid_domain', invalid.length > 0 ? `Not an e-mail domain: ${invalid.join(', ')}.` : 'Name at least one e-mail domain.');
  }
  if (input.required && !input.enabled) {
    throw new SsoConfigError('required_needs_enabled', 'Single sign-on can only be required while it is on.');
  }
  const secret = input.clientSecret?.trim() ?? '';

  try {
    await privilegedDb.transaction(async (tx) => {
      const [existing] = await tx
        .select({ organizationId: organizationSso.organizationId })
        .from(organizationSso)
        .where(eq(organizationSso.organizationId, organizationId));
      if (!existing && !secret) throw new SsoConfigError('secret_required', 'Enter the client secret.');

      const taken = await tx
        .select({ domain: ssoDomains.domain })
        .from(ssoDomains)
        .where(and(inArray(ssoDomains.domain, domains), ne(ssoDomains.organizationId, organizationId)));
      if (taken.length > 0) {
        throw new SsoConfigError('domain_taken', `Another organization on this installation signs in ${taken.map((t) => t.domain).join(', ')}.`);
      }

      const values = {
        // As typed: openid-client compares it with the discovery document's after normalising both.
        issuer: input.issuer.trim(),
        clientId: input.clientId.trim(),
        defaultRole: input.defaultRole,
        enabled: input.enabled,
        required: input.required,
        updatedAt: new Date(),
        ...(secret ? secretColumns(secret) : {}),
      };
      if (existing) {
        await tx.update(organizationSso).set(values).where(eq(organizationSso.organizationId, organizationId));
      } else {
        await tx.insert(organizationSso).values({ organizationId, ...values, ...secretColumns(secret) });
      }
      await tx.delete(ssoDomains).where(eq(ssoDomains.organizationId, organizationId));
      await tx.insert(ssoDomains).values(domains.map((domain) => ({ domain, organizationId })));

      await audit(tx, organizationId, actor, AUDIT_ACTIONS.SSO_CONFIGURED, 'organization', String(organizationId), {
        issuer: values.issuer,
        clientId: values.clientId,
        domains,
        defaultRole: input.defaultRole,
        enabled: input.enabled,
        required: input.required,
        secretChanged: Boolean(secret),
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
  return (await getSsoSettings(organizationId))!;
}

function secretColumns(secret: string) {
  const { encryptedValue, iv, authTag } = encryptSecret(secret);
  return { clientSecretEncrypted: encryptedValue, clientSecretIv: iv, clientSecretAuthTag: authTag };
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
  const secret = decryptSecret(row.clientSecretEncrypted, row.clientSecretIv, row.clientSecretAuthTag);
  const config = oidc.discovery(issuer, row.clientId, undefined, oidc.ClientSecretBasic(secret), {
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
  | 'account_linked';

/** Where to send the browser for an e-mail address, and what to remember until it comes back. */
export async function beginSignIn(
  email: string,
  redirectUri: string,
): Promise<{ url: URL; pending: SsoPending } | { error: SignInError; detail?: string }> {
  const domain = normaliseDomain(email.split('@').pop() ?? '');
  if (!email.includes('@') || !DOMAIN.test(domain)) return { error: 'unknown_domain' };
  const [match] = await privilegedDb
    .select({ organizationId: ssoDomains.organizationId })
    .from(ssoDomains)
    .innerJoin(organizationSso, eq(organizationSso.organizationId, ssoDomains.organizationId))
    .where(and(eq(ssoDomains.domain, domain), eq(organizationSso.enabled, true)));
  if (!match) return { error: 'unknown_domain' };

  const row = await providerRow(match.organizationId);
  if (!row) return { error: 'unknown_domain' };
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
    .where(and(eq(ssoDomains.domain, domain), eq(ssoDomains.organizationId, pending.organizationId)));
  if (!allowed) return { error: 'domain_not_allowed', organizationId: pending.organizationId };

  const identity = { issuer: claims.iss, subject: claims.sub };
  try {
    return await resolveAccount(pending.organizationId, identity, email, row.defaultRole as SsoRole);
  } catch (error) {
    // Two first sign-ins of one person at once: the second finds what the first created.
    if (sqlState(error) === '23505') return resolveAccount(pending.organizationId, identity, email, row.defaultRole as SsoRole);
    throw error;
  }
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

async function resolveAccount(
  organizationId: number,
  identity: { issuer: string; subject: string },
  email: string,
  defaultRole: SsoRole,
): Promise<SignedIn | { error: SignInError; organizationId: number }> {
  return privilegedDb.transaction(async (tx) => {
    const refuse = (error: SignInError) => ({ error, organizationId });
    const usable = (user: User) => user.kind === 'person' && !user.disabledAt;

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
      return { user, created: false, linked: false };
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
      return { user: existing, created: false, linked: true };
    }

    const [user] = await tx
      .insert(users)
      .values({ username: email, password: unusablePassword(), organizationId, role: defaultRole, kind: 'person' })
      .returning();
    await tx.insert(ssoIdentities).values({ ...identity, userId: user.id });
    await audit(tx, organizationId, { id: user.id, username: user.username, ipAddress: null }, AUDIT_ACTIONS.MEMBER_PROVISIONED, 'user', String(user.id), {
      role: defaultRole,
      issuer: identity.issuer,
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
