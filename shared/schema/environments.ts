/** Where tests run and with what: environments, secrets, runners, agents, browser grids, BDD profiles and test SMS inboxes. */
import { pgTable, text, integer, serial, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import type { BddAgentProfile } from '../bdd-agent';
import { organizations, projects, users } from './identity';

/**
 * The worker processes that run plans, as they describe themselves. Installation-wide and
 * outside RLS, like system_settings; see migrations/0033_runner_registry.sql.
 */
export const runners = pgTable(
  'runners',
  {
    id: text('id').primaryKey(),
    hostname: text('hostname').notNull(),
    pid: integer('pid').notNull(),
    version: text('version'),
    concurrency: integer('concurrency').notNull(),
    browserTaskConcurrency: integer('browser_task_concurrency').notNull(),
    browsers: jsonb('browsers').$type<string[]>().notNull().default([]),
    activeJobs: integer('active_jobs').notNull().default(0),
    /** 'drain' asks the runner to finish what it has and take nothing new. */
    desiredState: text('desired_state').$type<'active' | 'drain'>().notNull().default('active'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    /** Set when the runner shut down cleanly. */
    stoppedAt: timestamp('stopped_at'),
  },
  (table) => [index('runners_last_seen_at_idx').on(table.lastSeenAt)],
);

export type Runner = typeof runners.$inferSelect;

export const environments = pgTable(
  'environments',
  {
    id: serial('id').primaryKey(),
    // Unique within the organization, without case. The index is on lower(name), so it lives in
    // migrations/0041_environment_name_per_organization.sql rather than here, as for tags.
    name: text('name').notNull(),
    description: text('description'),
    // Who created it. The environment is the organization's: removing that member hands it to
    // another one rather than deleting it and its secrets (migration 0040).
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /**
     * A saved browser session (Playwright `storageState`), so a test can start already
     * authenticated instead of logging in through the UI first.
     *
     * Encrypted with the same AES-256-GCM scheme as `secrets`, and for the same reason: the
     * payload is cookies and session tokens, which are credentials for the system under test.
     * See migrations/0010_environment_login_state.sql.
     */
    loginState: text('login_state'),
    loginStateIv: text('login_state_iv'),
    loginStateAuthTag: text('login_state_auth_tag'),
    loginStateCapturedAt: timestamp('login_state_captured_at'),
  },
  (table) => [
    index('environments_user_id_idx').on(table.userId),
    index('environments_organization_id_idx').on(table.organizationId),
  ],
);

export const secrets = pgTable(
  'secrets',
  {
    id: serial('id').primaryKey(),
    environmentId: integer('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    keyName: text('key_name').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('secrets_environment_id_idx').on(table.environmentId),
    index('secrets_user_id_idx').on(table.userId),
    index('secrets_organization_id_idx').on(table.organizationId),
  ],
);

/** Text messages the organization's test numbers received (server/messaging/sms-inbox.ts, migration 0070). */
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    toNumber: text('to_number').notNull(),
    fromNumber: text('from_number'),
    body: text('body').notNull(),
    provider: text('provider'),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
  },
  (table) => [
    index('sms_messages_organization_to_idx').on(
      table.organizationId,
      table.toNumber,
      table.receivedAt,
    ),
  ],
);

export type SmsMessage = typeof smsMessages.$inferSelect;

/**
 * A local agent: a process inside a customer's network that lends browsers to the runner over
 * connections it opens itself (shared/agents.ts). Authenticated by a token shown once; stored
 * as its hash.
 */
export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    /** Plans name a pool, not an agent: any agent of the pool may take the run. */
    pool: text('pool').notNull().default('default'),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Written by the relay while the agent is connected. */
    lastSeenAt: timestamp('last_seen_at'),
    /** What it reported the last time it connected. */
    hostname: text('hostname'),
    agentVersion: text('agent_version'),
    playwrightVersion: text('playwright_version'),
    browsers: jsonb('browsers').$type<string[]>(),
    bddProfiles: jsonb('bdd_profiles').$type<BddAgentProfile[]>(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [index('agents_organization_id_idx').on(table.organizationId)],
);

export type Agent = typeof agents.$inferSelect;

export const bddExecutionProfiles = pgTable(
  'bdd_execution_profiles',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    pool: text('pool').notNull(),
    operatorProfileId: text('operator_profile_id').notNull(),
    revision: text('revision').notNull(),
    timeoutMs: integer('timeout_ms').notNull().default(60000),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('bdd_execution_profiles_organization_idx').on(table.organizationId)],
);

/**
 * Where a plan's browsers can come from besides the runners and the local agents: BrowserStack,
 * LambdaTest, or a Playwright server of the organization's own (shared/browser-grids.ts).
 *
 * The key is encrypted like an issue tracker's token and, like it, never sent back.
 */
export const browserGrids = pgTable(
  'browser_grids',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    username: text('username'),
    endpoint: text('endpoint'),
    encryptedKey: text('encrypted_key'),
    keyIv: text('key_iv'),
    keyAuthTag: text('key_auth_tag'),
    /** For a local Appium: the pool of agents that reach it (migration 0055). */
    agentPool: text('agent_pool'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('browser_grids_organization_id_idx').on(table.organizationId)],
);

export type BrowserGrid = typeof browserGrids.$inferSelect;

export type Environment = typeof environments.$inferSelect;
export type InsertEnvironment = typeof environments.$inferInsert;
export type Secret = typeof secrets.$inferSelect;
export type InsertSecret = typeof secrets.$inferInsert;
