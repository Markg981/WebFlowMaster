/** Connections to other systems: source hosts, issue trackers, requirements and test management tools. */
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  index,
  uniqueIndex,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { RequirementKind } from '../requirements';
import type { TestManagementProvider } from '../test-management';
import { apiTests } from './api-testing';
import { mobileTests, tests } from './authoring';
import { testPlanExecutions, testPlans } from './execution';
import { organizations, users } from './identity';

/** Where an organization's code lives, for the commit statuses a run reports (server/integrations/commit-status.ts). */
export const SOURCE_HOST_PROVIDERS = ['github', 'gitlab'] as const;
export type SourceHostProvider = (typeof SOURCE_HOST_PROVIDERS)[number];

/**
 * A GitHub or GitLab, with a token allowed to set commit statuses.
 *
 * A run a pipeline started names its repository and commit; the server reports on that commit as the
 * run goes. One per provider per organization, because the run says which provider it came from and
 * nothing more. The token is encrypted as a tracker's is and never leaves the server.
 */
export const sourceHosts = pgTable(
  'source_hosts',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: text('provider').$type<SourceHostProvider>().notNull(),
    /** https://api.github.com, a GitHub Enterprise's /api/v3, or a GitLab's /api/v4. */
    apiUrl: text('api_url').notNull(),
    encryptedToken: text('encrypted_token').notNull(),
    tokenIv: text('token_iv').notNull(),
    tokenAuthTag: text('token_auth_tag').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    /** The last status sent, and why it was refused if it was: the answer to "why is there no check?". */
    lastDeliveryAt: timestamp('last_delivery_at'),
    lastDeliveryError: text('last_delivery_error'),
  },
  (table) => [
    uniqueIndex('source_hosts_organization_provider_idx').on(table.organizationId, table.provider),
  ],
);

export type SourceHost = typeof sourceHosts.$inferSelect;

/** The trackers this build can actually file in. A provider with no implementation files nothing. */
export const ISSUE_PROVIDERS = ['jira', 'azure_devops'] as const;
export type IssueProvider = (typeof ISSUE_PROVIDERS)[number];

/**
 * Where a failure goes once somebody has to do something about it.
 *
 * A failed run ended in the report. Somebody read it, opened Jira in another tab, retyped the
 * test name, the browser, the error and a link — and did it again the next morning for the same
 * failure, because neither side knew the two were the same thing.
 *
 * The token is encrypted exactly as `secrets` are, and never leaves the server: the API answers
 * with the tracker and who it authenticates as, never with the credential.
 */
export const issueTrackers = pgTable(
  'issue_trackers',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    baseUrl: text('base_url').notNull(),
    /** The Jira project key (SHOP), or the Azure DevOps project name. */
    projectKey: text('project_key').notNull(),
    issueType: text('issue_type').default('Bug').notNull(),
    /** Jira authenticates an API token against an account's email; Azure DevOps ignores it. */
    userEmail: text('user_email'),
    encryptedToken: text('encrypted_token').notNull(),
    tokenIv: text('token_iv').notNull(),
    tokenAuthTag: text('token_auth_tag').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('issue_trackers_organization_id_idx').on(table.organizationId)],
);

/**
 * An epic, a user story or a plain requirement, and the tests that cover it
 * (shared/requirements.ts, migrations/0050). Typed in, or imported from the organization's Jira or
 * Azure DevOps; its coverage is worked out from the tests' latest results, never stored.
 */
export const requirements = pgTable(
  'requirements',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind').$type<RequirementKind>().notNull().default('story'),
    parentId: integer('parent_id').references((): AnyPgColumn => requirements.id, {
      onDelete: 'set null',
    }),
    trackerId: text('tracker_id').references(() => issueTrackers.id, { onDelete: 'set null' }),
    url: text('url'),
    /** The tracker's own words for it: "Story", "User Story", "Epic", "Feature". */
    externalType: text('external_type'),
    externalStatus: text('external_status'),
    syncedAt: timestamp('synced_at'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('requirements_organization_id_idx').on(table.organizationId),
    index('requirements_parent_id_idx').on(table.parentId),
  ],
);

export type Requirement = typeof requirements.$inferSelect;

/**
 * A TestRail, Xray or Zephyr Scale account the organization publishes run results to
 * (shared/test-management.ts, migrations/0051). The token is encrypted and never sent back.
 */
export const testManagementConnections = pgTable(
  'test_management_connections',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    provider: text('provider').$type<TestManagementProvider>().notNull(),
    baseUrl: text('base_url').notNull(),
    username: text('username'),
    projectKey: text('project_key').notNull(),
    suiteId: text('suite_id'),
    testPlanKey: text('test_plan_key'),
    encryptedToken: text('encrypted_token').notNull(),
    tokenIv: text('token_iv').notNull(),
    tokenAuthTag: text('token_auth_tag').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('test_management_connections_organization_id_idx').on(table.organizationId)],
);

export type TestManagementConnection = typeof testManagementConnections.$inferSelect;

/** Which case in the tool each test is. */
export const testCaseLinks = pgTable(
  'test_case_links',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    connectionId: text('connection_id')
      .notNull()
      .references(() => testManagementConnections.id, { onDelete: 'cascade' }),
    testType: text('test_type').$type<'ui' | 'api' | 'mobile'>().notNull(),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    /** A mobile app test (migration 0054). Plain integer here: mobile_tests is declared further down. */
    mobileTestId: integer('mobile_test_id'),
    caseKey: text('case_key').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('test_case_links_connection_id_idx').on(table.connectionId)],
);

/** Each publication of a run to a tool, and what came of it. */
export const testManagementPublications = pgTable(
  'test_management_publications',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testPlanExecutionId: text('test_plan_execution_id')
      .notNull()
      .references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => testManagementConnections.id, {
      onDelete: 'set null',
    }),
    connectionName: text('connection_name').notNull(),
    provider: text('provider').notNull(),
    status: text('status')
      .$type<'published' | 'partial' | 'failed' | 'nothing_to_publish'>()
      .notNull(),
    externalKey: text('external_key'),
    externalUrl: text('external_url'),
    publishedCount: integer('published_count').notNull().default(0),
    unmappedCount: integer('unmapped_count').notNull().default(0),
    message: text('message'),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('test_management_publications_execution_idx').on(table.testPlanExecutionId)],
);

export type TestManagementPublication = typeof testManagementPublications.$inferSelect;

/** Which tests cover which requirement. */
export const requirementTests = pgTable(
  'requirement_tests',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    requirementId: integer('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    testType: text('test_type').$type<'ui' | 'api' | 'mobile'>().notNull(),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    /** A mobile app test (migration 0054). */
    mobileTestId: integer('mobile_test_id').references(() => mobileTests.id, {
      onDelete: 'cascade',
    }),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('requirement_tests_requirement_id_idx').on(table.requirementId),
    index('requirement_tests_test_id_idx').on(table.testId),
    index('requirement_tests_api_test_id_idx').on(table.apiTestId),
  ],
);

export type IssueTracker = typeof issueTrackers.$inferSelect;
export type InsertIssueTracker = typeof issueTrackers.$inferInsert;

/**
 * Which failure produced which issue.
 *
 * The point of writing it down is not filing the same bug twice: a nightly plan that fails for
 * a week would open seven identical issues, and by the eighth morning nobody reads any of them.
 * `dedupeKey` is what "the same failure" means — this plan, this test, this browser — and the
 * unique index on it is the constraint the whole feature rests on.
 *
 * Every reference is ON DELETE SET NULL: the issue exists in Jira whatever happens here, and a
 * link table that forgets it is how a duplicate gets opened.
 */
export const issueLinks = pgTable(
  'issue_links',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    trackerId: text('tracker_id')
      .notNull()
      .references(() => issueTrackers.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    testPlanId: text('test_plan_id').references(() => testPlans.id, { onDelete: 'set null' }),
    uiTestId: integer('ui_test_id').references(() => tests.id, { onDelete: 'set null' }),
    /** Kept as text too: the name is what the issue says, and it must stay readable. */
    testName: text('test_name').notNull(),
    browser: text('browser'),
    issueKey: text('issue_key').notNull(),
    issueUrl: text('issue_url').notNull(),
    firstExecutionId: text('first_execution_id').references(() => testPlanExecutions.id, {
      onDelete: 'set null',
    }),
    lastExecutionId: text('last_execution_id').references(() => testPlanExecutions.id, {
      onDelete: 'set null',
    }),
    occurrences: integer('occurrences').default(1).notNull(),
    /**
     * Set when the test passed again. Local knowledge only: whether the issue is closed is the
     * tracker's business, and claiming to know it would be claiming more than this can see.
     */
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('issue_links_organization_id_idx').on(table.organizationId),
    index('issue_links_tracker_id_idx').on(table.trackerId),
    index('issue_links_test_plan_id_idx').on(table.testPlanId),
    index('issue_links_last_execution_id_idx').on(table.lastExecutionId),
    unique('issue_links_tracker_dedupe_unique').on(table.trackerId, table.dedupeKey),
  ],
);

export type IssueLink = typeof issueLinks.$inferSelect;
export type InsertIssueLink = typeof issueLinks.$inferInsert;
