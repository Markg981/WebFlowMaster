/** Organizations, users and access: tenancy, quotas, SSO and SCIM, sessions, API keys and the audit log. */
import {
  pgTable,
  text,
  integer,
  bigint,
  serial,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

// Table Definitions
export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /**
   * This organization's share of the execution plane — see server/tenant-quotas.ts. Null is the
   * installation's default. Set by the operator; the application has no grant to change them.
   */
  maxConcurrentRuns: integer('max_concurrent_runs'),
  maxQueuedRuns: integer('max_queued_runs'),
  quotaMode: text('quota_mode').$type<import('../tenant-quotas').QuotaMode>(),
  maxTests: bigint('max_tests', { mode: 'number' }),
  maxArtifactBytes: bigint('max_artifact_bytes', { mode: 'number' }),
  maxMonthlyExecutionMinutes: bigint('max_monthly_execution_minutes', { mode: 'number' }),
  quotaRevision: integer('quota_revision').notNull().default(1),
  artifactsReconciledAt: timestamp('artifacts_reconciled_at'),
  /** Every member signing in with a password must use a second factor. Keys are not affected. */
  mfaRequired: boolean('mfa_required').notNull().default(false),
  /** Publishing a test needs another member's approval, and plans run published tests only. */
  testReviewRequired: boolean('test_review_required').notNull().default(false),
  /** The test SMS inbox's inbound address token, hashed (server/sms-inbox.ts, migration 0070). */
  smsInboundTokenHash: text('sms_inbound_token_hash'),
  smsInboundTokenPrefix: text('sms_inbound_token_prefix'),
  smsInboundTokenCreatedAt: timestamp('sms_inbound_token_created_at'),
});

export const quotaExecutionSessions = pgTable(
  'quota_execution_sessions',
  {
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    executionId: text('execution_id').notNull(),
    startedAt: timestamp('started_at').notNull(),
    heartbeatAt: timestamp('heartbeat_at').notNull(),
    endedAt: timestamp('ended_at'),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.kind, table.executionId] }),
    index('quota_execution_period_idx').on(table.organizationId, table.startedAt),
  ],
);

export const quotaArtifacts = pgTable(
  'quota_artifacts',
  {
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    reservedBytes: bigint('reserved_bytes', { mode: 'number' }).notNull().default(0),
    reservationId: text('reservation_id'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.key] })],
);

export const quotaInstallationDefaults = pgTable('quota_installation_defaults', {
  id: integer('id').primaryKey(),
  mode: text('mode').notNull(),
  maxTests: bigint('max_tests', { mode: 'number' }).notNull(),
  maxArtifactBytes: bigint('max_artifact_bytes', { mode: 'number' }).notNull().default(0),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  // The tenancy boundary. One user belongs to exactly one organization.
  organizationId: integer('organization_id')
    .notNull()
    .references(() => organizations.id),
  // Verbs, not rows: RLS decides which rows are visible, this decides what may be done to them.
  role: text('role').notNull().default('editor'),
  /** 'person' signs in with a password; 'service' never signs in and exists to hold API keys. */
  kind: text('kind').notNull().default('person'),
  /** What a service account is called. Its username is generated, being unique across organizations. */
  displayName: text('display_name'),
  /**
   * A disabled service account keeps its row, so the runs it started still name it. A person is
   * disabled by their identity provider through SCIM (server/scim.ts): they cannot sign in, their
   * sessions and keys stop working, and the account comes back as it was when they are reactivated.
   */
  disabledAt: timestamp('disabled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * A user's second factor. Its own table so no secret rides along on the user row, which goes
 * everywhere (session, /api/user, req.user). Reached only through server/mfa.ts; app_user has
 * no grant on it. See migrations/0030_mfa_totp.sql.
 */
export const userMfa = pgTable('user_mfa', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted'),
  secretIv: text('secret_iv'),
  secretAuthTag: text('secret_auth_tag'),
  pendingSecretEncrypted: text('pending_secret_encrypted'),
  pendingSecretIv: text('pending_secret_iv'),
  pendingSecretAuthTag: text('pending_secret_auth_tag'),
  enabledAt: timestamp('enabled_at'),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  /** SHA-256 hashes of the unused recovery codes. */
  recoveryCodes: jsonb('recovery_codes').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSettings = pgTable('user_settings', {
  // A person's own preferences: they go with the account (migration 0040).
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme').default('light').notNull(),
  defaultTestUrl: text('default_test_url'),
  playwrightBrowser: text('playwright_browser').default('chromium').notNull(),
  playwrightHeadless: boolean('playwright_headless').default(true).notNull(),
  playwrightDefaultTimeout: integer('playwright_default_timeout').default(30000).notNull(),
  playwrightWaitTime: integer('playwright_wait_time').default(1000).notNull(),
  language: text('language').default('en').notNull(),
  /**
   * E-mail about the runs this person starts (server/mail-messages.ts): the master switch, then
   * when. Off until the person turns it on; nothing is sent while the installation has no SMTP.
   */
  notifyByEmail: boolean('notify_by_email').default(false).notNull(),
  notifyRunCompleted: boolean('notify_run_completed').default(true).notNull(),
  notifyRunFailed: boolean('notify_run_failed').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /**
     * Visible only to the organization's owners and the project's members (project_members), who
     * may edit it only as editors there. Enforced by RLS — see migrations/0031_project_access.sql.
     */
    restricted: boolean('restricted').notNull().default(false),
  },
  (table) => [
    index('projects_user_id_idx').on(table.userId),
    index('projects_organization_id_idx').on(table.organizationId),
  ],
);

/**
 * Who is on a restricted project, and as what. A project role only ever narrows the
 * organization role: an organization viewer who is an editor here is still a viewer.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** 'viewer' | 'editor' */
    role: text('role').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_members_organization_id_idx').on(table.organizationId),
    index('project_members_user_id_idx').on(table.userId),
  ],
);

export type ProjectMember = typeof projectMembers.$inferSelect;

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

/**
 * A standing offer for a named username to join an organization.
 *
 * A user belongs to exactly one organization, so "adding a member" cannot mean moving an
 * existing account — that would take away their own organization's data without their say.
 * An invitation therefore names a username that does not exist yet: whoever registers with
 * the token lands in this organization instead of getting one of their own.
 *
 * Deliberately NOT in ORG_SCOPED_TABLES, for the same reason `users` is not: registration has
 * to look an invitation up by token before any tenant context exists, and an RLS policy would
 * make that impossible. Every query from a route therefore carries its own organizationId
 * predicate, and app_user's grants on this table are narrow (see the migration).
 */
export const invitations = pgTable(
  'invitations',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** The username the invitation is for. Checked as still-unregistered at accept time too. */
    username: text('username').notNull(),
    /** The role the invitee gets on arrival. Never 'owner' — see the route. */
    role: text('role').notNull().default('editor'),
    /** Unguessable, and the only thing needed to accept. Unique so a lookup cannot be ambiguous. */
    token: text('token').notNull().unique(),
    /** Null once the inviting member's account is gone (migration 0040). */
    invitedByUserId: integer('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at').notNull(),
    /** Set once used. A used invitation is kept for the audit trail rather than deleted. */
    acceptedAt: timestamp('accepted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('invitations_organization_id_idx').on(table.organizationId),
    // One pending invitation per username per organization (migration 0044): accepted ones stay
    // for the audit trail and do not stop a removed member's username from being invited again.
    // Two organizations may both invite the same username; whichever token is used first wins,
    // and the other is then unacceptable because the username exists.
    uniqueIndex('invitations_org_username_pending_unique')
      .on(table.organizationId, table.username)
      .where(sql`${table.acceptedAt} IS NULL`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;

/**
 * A one-time link that lets a member choose a new password (server/password-reset.ts).
 *
 * The application sends no e-mail, so a forgotten password is recovered through an owner, who
 * issues one of these and hands the link over, or through the operator's command line. The token
 * is stored only as its SHA-256. Org-scoped like the rest; redeeming it is the one privileged
 * lookup, in server/storage.ts, because nobody is signed in yet.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('password_resets_organization_id_idx').on(table.organizationId),
    index('password_resets_user_id_idx').on(table.userId),
  ],
);

export type PasswordReset = typeof passwordResets.$inferSelect;

/**
 * Single sign-on with OpenID Connect (server/sso.ts, migrations/0043_sso.sql).
 *
 * An organization's identity provider, the e-mail domains it signs in, and which account each
 * identity at a provider is. Not in ORG_SCOPED_TABLES, like user_mfa: the provider for a domain is
 * found before anyone is signed in. app_user has no grant on any of them; server/sso.ts names the
 * organization in every statement.
 */
export const organizationSso = pgTable(
  'organization_sso',
  {
    organizationId: integer('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** 'oidc' or 'saml' (migration 0059). */
    protocol: text('protocol').notNull().default('oidc'),
    /** OpenID Connect: the issuer URL. SAML: the identity provider's entity ID. */
    issuer: text('issuer').notNull(),
    /** OpenID Connect only, like the secret. */
    clientId: text('client_id'),
    clientSecretEncrypted: text('client_secret_encrypted'),
    clientSecretIv: text('client_secret_iv'),
    clientSecretAuthTag: text('client_secret_auth_tag'),
    /** SAML only: where AuthnRequests go (HTTP-Redirect binding). */
    samlSsoUrl: text('saml_sso_url'),
    /** SAML only: the provider's signing certificate, PEM. Public, so not encrypted. */
    samlCertificate: text('saml_certificate'),
    samlAllowIdpInitiated: boolean('saml_allow_idp_initiated').notNull().default(false),
    samlRequireEncryptedAssertions: boolean('saml_require_encrypted_assertions')
      .notNull()
      .default(false),
    samlSloUrl: text('saml_slo_url'),
    samlSpCertificate: text('saml_sp_certificate'),
    samlSpPrivateKeyEncrypted: text('saml_sp_private_key_encrypted'),
    samlSpPrivateKeyIv: text('saml_sp_private_key_iv'),
    samlSpPrivateKeyAuthTag: text('saml_sp_private_key_auth_tag'),
    /** The role of an account created on its first sign-in: viewer or editor, never owner. */
    defaultRole: text('default_role').notNull().default('viewer'),
    enabled: boolean('enabled').notNull().default(true),
    /** Members other than owners must sign in through the provider; their passwords stop working. */
    required: boolean('required').notNull().default(false),
    /** The claim (OpenID Connect) or attribute (SAML) carrying the groups; null means "groups". */
    groupAttribute: text('group_attribute'),
    /** Group → role, applied at every sign-in (shared/sso-roles.ts). Empty: roles are managed here. */
    roleMappings: jsonb('role_mappings')
      .$type<Array<{ group: string; role: 'viewer' | 'editor' | 'owner' }>>()
      .notNull()
      .default([]),
    /** With mappings, refuse a person who is in none of the mapped groups. */
    requireGroup: boolean('require_group').notNull().default(false),
    /**
     * The bearer token the provider's SCIM client presents (server/scim.ts, migration 0064): its
     * SHA-256, like an API key's, and enough of it to recognise in a list. Null: no provisioning.
     */
    scimTokenHash: text('scim_token_hash'),
    scimTokenPrefix: text('scim_token_prefix'),
    scimTokenCreatedAt: timestamp('scim_token_created_at'),
    scimTokenLastUsedAt: timestamp('scim_token_last_used_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('organization_sso_scim_token_hash_idx').on(table.scimTokenHash)],
);

/**
 * Provisioning with SCIM 2.0 (server/scim.ts, migration 0064). Not RLS-scoped, like the other
 * single sign-on tables: the token names the organization before any tenant exists, and every
 * statement in server/scim.ts names it.
 *
 * scim_users marks the accounts the provider manages and keeps the id it knows them by; the
 * account itself is an ordinary users row, its SCIM id the user id.
 */
export const scimUsers = pgTable(
  'scim_users',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    /** Deactivated because, with "require a group", the person is in none of the mapped groups (migration 0066). */
    disabledByGroups: boolean('disabled_by_groups').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('scim_users_organization_id_idx').on(table.organizationId)],
);

/** The provider's groups as it pushes them. Their names and external ids are what role mappings match. */
export const scimGroups = pgTable(
  'scim_groups',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    externalId: text('external_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('scim_groups_organization_id_idx').on(table.organizationId)],
);

export const scimGroupMembers = pgTable(
  'scim_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => scimGroups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ name: 'scim_group_members_pkey', columns: [table.groupId, table.userId] }),
    index('scim_group_members_user_id_idx').on(table.userId),
  ],
);

/**
 * SAML AuthnRequests sent and not yet answered (migration 0059). A response must answer one, and
 * answering removes it. Logout requests are correlated separately; opt-in unsolicited assertions
 * use the replay registry. Not RLS-scoped, like the other sso tables.
 */
export const ssoSamlRequests = pgTable(
  'sso_saml_requests',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    purpose: text('purpose').notNull().default('authn'),
    sessionId: text('session_id'),
  },
  (table) => [index('sso_saml_requests_created_at_idx').on(table.createdAt)],
);

/** Signed SAML message identifiers consumed once, before authentication or logout. */
export const ssoSamlReplay = pgTable(
  'sso_saml_replay',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [index('sso_saml_replay_expires_at_idx').on(table.expiresAt)],
);

/** SAML sessions addressable by signed logout messages even without a cross-site cookie. */
export const ssoSamlSessions = pgTable(
  'sso_saml_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    nameId: text('name_id').notNull(),
    nameIdFormat: text('name_id_format'),
    sessionIndex: text('session_index'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('sso_saml_sessions_identity_idx').on(
      table.organizationId,
      table.issuer,
      table.nameId,
      table.sessionIndex,
    ),
  ],
);

export const ssoDomains = pgTable(
  'sso_domains',
  {
    /** Lower case. The primary key: one organization per domain. */
    domain: text('domain').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** What the TXT record _wfm-verification.<domain> must say (shared/sso-roles.ts). */
    verificationToken: text('verification_token'),
    /** When the record was found; null while the domain is unproven. */
    verifiedAt: timestamp('verified_at'),
  },
  (table) => [index('sso_domains_organization_id_idx').on(table.organizationId)],
);

export const ssoIdentities = pgTable(
  'sso_identities',
  {
    issuer: text('issuer').notNull(),
    /** The provider's stable identifier for the person (the `sub` claim), not their e-mail address. */
    subject: text('subject').notNull(),
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastSignInAt: timestamp('last_sign_in_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ name: 'sso_identities_pkey', columns: [table.issuer, table.subject] })],
);

/**
 * Append-only record of who changed what, within one organization.
 *
 * Two properties make this an audit log rather than a table of log lines:
 *
 * It is append-only at the database level, not by convention — app_user is granted SELECT and
 * INSERT and nothing else (see the migration), so the application physically cannot rewrite
 * or erase history. A log the application can edit is not evidence of anything.
 *
 * And an entry is written in the same transaction as the change it describes, so the two
 * commit or roll back together. An entry that survives a failed change is a false record; a
 * change with no entry is an invisible one.
 *
 * `actorUserId` is nullable and ON DELETE SET NULL: removing a member must not erase what they
 * did, and must not be blocked by the fact that they did it.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** Null once the actor's account is gone, or for an action taken before one existed. */
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Kept alongside actorUserId so the entry still names someone after the account is deleted. */
    actorUsername: text('actor_username'),
    /** Dotted verb, e.g. 'member.role_changed'. See AUDIT_ACTIONS. */
    action: text('action').notNull(),
    /** What the action was done to: 'user', 'invitation', 'organization'. */
    targetType: text('target_type'),
    /** Text rather than integer: targets are variously serial ids and uuids. */
    targetId: text('target_id'),
    /** Before/after values and anything else needed to understand the entry. Never secrets. */
    metadata: jsonb('metadata'),
    /** The API key the request authenticated with. Null for a session, or for the system itself. */
    apiKeyId: text('api_key_id'),
    /** The client address as the application saw it. */
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_organization_id_idx').on(table.organizationId),
    index('audit_log_created_at_idx').on(table.createdAt),
    index('audit_log_organization_action_idx').on(table.organizationId, table.action),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;

/**
 * A credential for something that is not a person.
 *
 * Everything here was behind a passport session, so a pipeline could only reach the API by
 * holding somebody's password — which turns an account into a service account and makes a
 * leaver break the build.
 *
 * The key is never stored: `hashedKey` is its SHA-256 and `prefix` is its first characters,
 * kept only so a list of keys can be told apart. A key carries the role of the user who made
 * it, so nothing downstream needs a second authorisation model.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** The key acts as this user. Deleting the member takes their keys with them. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What it is for, in the words of whoever created it: "GitHub Actions", "nightly". */
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hashedKey: text('hashed_key').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Answers "is this key still in use?", which is what makes cleaning them up possible. */
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    /** Set instead of deleting, so a key that ran ten thousand builds stays nameable. */
    revokedAt: timestamp('revoked_at'),
    /**
     * What the key may do, through /api/v1 only (see shared/api-scopes.ts). Null is a key from
     * before scopes: it acts as its user, with their role, on every endpoint, as it always did.
     */
    scopes: text('scopes').array(),
  },
  (table) => [
    index('api_keys_organization_id_idx').on(table.organizationId),
    index('api_keys_user_id_idx').on(table.userId),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

/**
 * The actions worth recording, as a closed set: a free-text action column drifts into
 * near-duplicates ('member.removed' and 'member.remove') that nobody can query reliably.
 */
export const AUDIT_ACTIONS = {
  ORGANIZATION_QUOTAS_UPDATED: 'organization.quotas_updated',
  ORGANIZATION_ARTIFACTS_RECONCILED: 'organization.artifacts_reconciled',
  BDD_PROFILE_CREATED: 'bdd_profile.created',
  BDD_PROFILE_UPDATED: 'bdd_profile.updated',
  BDD_PROFILE_DELETED: 'bdd_profile.deleted',
  MAIL_SETTINGS_CHANGED: 'mail_settings.changed',
  MAIL_TEMPLATE_CHANGED: 'mail_template.changed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_REMOVED: 'member.removed',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_REVOKED: 'invitation.revoked',
  INVITATION_ACCEPTED: 'invitation.accepted',
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',
  SERVICE_ACCOUNT_CREATED: 'service_account.created',
  SERVICE_ACCOUNT_DISABLED: 'service_account.disabled',
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_DELETED: 'webhook.deleted',
  // Signing in and out. A failed attempt is recorded only for a username that exists: an
  // unknown one belongs to no organization, and a trail of it would be a list of guesses.
  LOGIN_SUCCEEDED: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  // What the organization's tests are, and what runs them.
  TEST_CREATED: 'test.created',
  TEST_UPDATED: 'test.updated',
  TEST_DELETED: 'test.deleted',
  TEST_VERSION_RESTORED: 'test.version_restored',
  // Tests read back from a file made by the export (server/test-bundle.ts), in one entry.
  TESTS_IMPORTED: 'test.imported',
  API_TEST_CREATED: 'api_test.created',
  API_TEST_UPDATED: 'api_test.updated',
  API_TEST_DELETED: 'api_test.deleted',
  // Tests made from an OpenAPI description or a Postman collection, in one entry (server/api-import.ts).
  API_TESTS_IMPORTED: 'api_test.imported',
  PLAN_CREATED: 'plan.created',
  PLAN_UPDATED: 'plan.updated',
  PLAN_DELETED: 'plan.deleted',
  SCHEDULE_CREATED: 'schedule.created',
  SCHEDULE_UPDATED: 'schedule.updated',
  SCHEDULE_DELETED: 'schedule.deleted',
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  // Restricting a project, or changing who is on it and as what.
  PROJECT_ACCESS_CHANGED: 'project.access_changed',
  // Which version of a test plans run, and the reviews that decide it.
  TEST_PUBLISHED: 'test.published',
  TEST_ROLLED_BACK: 'test.rolled_back',
  TEST_UNPUBLISHED: 'test.unpublished',
  TEST_REVIEW_REQUESTED: 'test_review.requested',
  TEST_REVIEW_APPROVED: 'test_review.approved',
  TEST_REVIEW_REJECTED: 'test_review.rejected',
  TEST_REVIEW_WITHDRAWN: 'test_review.withdrawn',
  TEST_REVIEW_POLICY_CHANGED: 'test_review.policy_changed',
  // Taking a runner out of service, and putting it back.
  RUNNER_DRAINED: 'runner.drained',
  RUNNER_RESUMED: 'runner.resumed',
  // Suites, and which plans include them.
  SUITE_CREATED: 'suite.created',
  SUITE_UPDATED: 'suite.updated',
  SUITE_DELETED: 'suite.deleted',
  PLAN_SUITES_CHANGED: 'plan.suites_changed',
  // Setting an unreliable test aside, and bringing it back.
  TEST_QUARANTINED: 'test.quarantined',
  TEST_QUARANTINE_RELEASED: 'test.quarantine_released',
  // Local agents: the machines inside a customer's network that lend browsers to runs.
  AGENT_CREATED: 'agent.created',
  AGENT_REVOKED: 'agent.revoked',
  // The GitHub or GitLab a run reports its commit status to.
  SOURCE_HOST_CONNECTED: 'source_host.connected',
  SOURCE_HOST_REMOVED: 'source_host.removed',
  RUN_CANCELLED: 'run.cancelled',
  // A person's verdict on a manual test in a run (shared/manual-tests.ts).
  RUN_MANUAL_RESULT_RECORDED: 'run.manual_result_recorded',
  RUN_FAILURE_ANALYSED: 'run.failure_analysed',
  // Where tests run and with what. Secrets by name only — never a value.
  ENVIRONMENT_CREATED: 'environment.created',
  ENVIRONMENT_DELETED: 'environment.deleted',
  SECRET_SET: 'secret.set',
  SECRET_DELETED: 'secret.deleted',
  SYSTEM_SETTINGS_CHANGED: 'system_settings.changed',
  // The second factor. Never the secret or a code.
  MFA_ENABLED: 'mfa.enabled',
  MFA_DISABLED: 'mfa.disabled',
  MFA_RECOVERY_CODES_REGENERATED: 'mfa.recovery_codes_regenerated',
  MFA_RECOVERY_CODE_USED: 'mfa.recovery_code_used',
  MFA_POLICY_CHANGED: 'mfa.policy_changed',
  // Passwords. Never the password, the hash or a reset token.
  PASSWORD_CHANGED: 'auth.password_changed',
  PASSWORD_RESET_ISSUED: 'auth.password_reset_issued',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  // Single sign-on: the provider an owner set up or removed, and accounts it created. Never the secret.
  SSO_CONFIGURED: 'sso.configured',
  SSO_REMOVED: 'sso.removed',
  SSO_DOMAIN_VERIFIED: 'sso.domain_verified',
  MEMBER_PROVISIONED: 'member.provisioned',
  // Provisioning with SCIM: the token the provider holds, and what it does to accounts and groups.
  // Never the token.
  SCIM_TOKEN_ISSUED: 'scim.token_issued',
  SCIM_TOKEN_REVOKED: 'scim.token_revoked',
  MEMBER_DEACTIVATED: 'member.deactivated',
  MEMBER_REACTIVATED: 'member.reactivated',
  MEMBER_RENAMED: 'member.renamed',
  SCIM_GROUP_CREATED: 'scim.group_created',
  SCIM_GROUP_UPDATED: 'scim.group_updated',
  SCIM_GROUP_DELETED: 'scim.group_deleted',
  // An organization's own steps. They are code that runs against the applications under test,
  // so who wrote and changed them is kept — the script itself is not, only its size.
  TEST_DATA_SET_CREATED: 'test_data_set.created',
  TEST_DATA_SET_UPDATED: 'test_data_set.updated',
  TEST_DATA_SET_DELETED: 'test_data_set.deleted',
  // The impact map: which files map to which tests (server/test-impact.ts).
  IMPACT_RULE_CREATED: 'impact_rule.created',
  IMPACT_RULE_DELETED: 'impact_rule.deleted',
  // The test SMS inbox's inbound address (server/sms-inbox.ts).
  SMS_INBOX_TOKEN_ISSUED: 'sms_inbox.token_issued',
  SMS_INBOX_TOKEN_REVOKED: 'sms_inbox.token_revoked',
  CUSTOM_ACTION_CREATED: 'custom_action.created',
  CUSTOM_ACTION_UPDATED: 'custom_action.updated',
  CUSTOM_ACTION_DELETED: 'custom_action.deleted',
  // What the tests are for: requirements, where they came from, and which tests cover them.
  REQUIREMENT_CREATED: 'requirement.created',
  REQUIREMENT_UPDATED: 'requirement.updated',
  REQUIREMENT_DELETED: 'requirement.deleted',
  REQUIREMENTS_IMPORTED: 'requirement.imported',
  REQUIREMENT_TESTS_CHANGED: 'requirement.tests_changed',
  // TestRail, Xray and Zephyr Scale: the connection, which case each test is, and each run sent there.
  TEST_MANAGEMENT_CONNECTED: 'test_management.connected',
  TEST_MANAGEMENT_UPDATED: 'test_management.updated',
  TEST_MANAGEMENT_REMOVED: 'test_management.removed',
  TEST_CASE_LINKS_CHANGED: 'test_management.cases_changed',
  RUN_PUBLISHED: 'test_management.run_published',
  // Tests of native mobile apps, and the apps uploaded to a grid for them.
  MOBILE_TEST_CREATED: 'mobile_test.created',
  MOBILE_TEST_UPDATED: 'mobile_test.updated',
  MOBILE_TEST_DELETED: 'mobile_test.deleted',
  MOBILE_TEST_RUN: 'mobile_test.run',
  MOBILE_APP_UPLOADED: 'mobile_test.app_uploaded',
  MOBILE_INSPECTOR_OPENED: 'mobile_test.inspector_opened',
  // Load tests: API tests under virtual users, run on their own.
  LOAD_TEST_CREATED: 'load_test.created',
  LOAD_TEST_UPDATED: 'load_test.updated',
  LOAD_TEST_DELETED: 'load_test.deleted',
  LOAD_TEST_RUN: 'load_test.run',
  LOAD_TEST_CANCELLED: 'load_test.cancelled',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const sessions = pgTable(
  'sessions',
  {
    sid: text('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire').notNull(),
  },
  (table) => [index('sessions_expire_idx').on(table.expire)],
);

// Zod Schemas for Insertions
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertProjectSchema = createInsertSchema(projects, {
  name: z.string().min(1, 'Project name cannot be empty'),
}).pick({ name: true });

// Export Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

export const insertSystemSettingSchema = createInsertSchema(systemSettings);
export const selectSystemSettingSchema = createSelectSchema(systemSettings);
