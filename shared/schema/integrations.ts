/** Connections to other systems: source hosts, issue trackers, requirements and test management tools. */
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  unique,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  HubResultStatus,
  HubStageMetrics,
  HubWaveAttempt,
  HubWorkbookLink,
} from '../hub-waves';
import type { RequirementKind } from '../requirements';
import type { TestManagementProvider } from '../test-management';
import type { HubSourceKind } from '../testcases-hub';
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

/**
 * The QA test case hub an organization reads its test case definitions from (shared/testcases-hub.ts).
 *
 * One per organization: a folder the server can see (under an operator-allowed root), or an
 * Azure DevOps git repository read through its REST API with a token encrypted as a tracker's.
 * Refreshing fills `hub_test_cases`; importing picks rows of it and makes manual tests of them.
 */
export const testCaseSources = pgTable(
  'test_case_sources',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').$type<HubSourceKind>().notNull(),
    name: text('name').notNull(),
    /** `folder`: the directory that holds TestCasesDefinitions/. */
    path: text('path'),
    /** `azure-devops`: organization URL, project, repository and branch. */
    baseUrl: text('base_url'),
    project: text('project'),
    repository: text('repository'),
    branch: text('branch'),
    encryptedToken: text('encrypted_token'),
    tokenIv: text('token_iv'),
    tokenAuthTag: text('token_auth_tag'),
    lastRefreshAt: timestamp('last_refresh_at'),
    /** The commit the catalog was read from, when the source knows one. */
    lastRefreshHead: text('last_refresh_head'),
    lastRefreshStatus: text('last_refresh_status').$type<'ok' | 'failed'>(),
    lastRefreshError: text('last_refresh_error'),
    caseCount: integer('case_count').default(0).notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('test_case_sources_organization_id_unique').on(table.organizationId),
    unique('test_case_sources_id_organization_unique').on(table.id, table.organizationId),
  ],
);

export type TestCaseSource = typeof testCaseSources.$inferSelect;
export type InsertTestCaseSource = typeof testCaseSources.$inferInsert;

/**
 * The catalog: what the hub held at the last refresh, one row per case, and which library test
 * each imported case became.
 *
 * `test_id` is the link; `imported_hash` is the content it was made from, so that a later
 * refresh can say "changed in the hub since you imported it" without touching the test.
 * A case that disappears from the hub keeps its row with `missing_since` set: the test it
 * became still says where it came from.
 */
export const hubTestCases = pgTable(
  'hub_test_cases',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => testCaseSources.id, { onDelete: 'cascade' }),
    caseId: text('case_id').notNull(),
    rawId: text('raw_id').notNull(),
    module: text('module').notNull(),
    executionModule: text('execution_module'),
    status: text('status').notNull(),
    priority: text('priority'),
    readinessLevel: integer('readiness_level').default(0).notNull(),
    versionFrom: text('version_from'),
    versionTo: text('version_to'),
    devopsId: text('devops_id'),
    sme: text('sme'),
    featureHighlight: text('feature_highlight'),
    executionGroup: text('execution_group'),
    functionalObjective: text('functional_objective').default('').notNull(),
    precondition: text('precondition').default('').notNull(),
    steps: text('steps').default('').notNull(),
    expectedOutcome: text('expected_outcome').default('').notNull(),
    refEnvPrecondition: text('ref_env_precondition').default('').notNull(),
    refEnvSteps: text('ref_env_steps').default('').notNull(),
    refEnvExpectedOutcome: text('ref_env_expected_outcome').default('').notNull(),
    dependsOn: jsonb('depends_on').$type<string[]>().default([]).notNull(),
    forceNotTested: boolean('force_not_tested').default(false).notNull(),
    sourceUpdatedAt: timestamp('source_updated_at'),
    contentHash: text('content_hash').notNull(),
    refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
    missingSince: timestamp('missing_since'),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'set null' }),
    importedHash: text('imported_hash'),
    importedAt: timestamp('imported_at'),
    importedBy: integer('imported_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    foreignKey({
      name: 'hub_test_cases_source_id_same_org_fk',
      columns: [table.sourceId, table.organizationId],
      foreignColumns: [testCaseSources.id, testCaseSources.organizationId],
    }),
    foreignKey({
      name: 'hub_test_cases_test_id_same_org_fk',
      columns: [table.testId, table.organizationId],
      foreignColumns: [tests.id, tests.organizationId],
    }),
    index('hub_test_cases_organization_id_idx').on(table.organizationId),
    uniqueIndex('hub_test_cases_source_case_unique').on(table.sourceId, table.caseId),
    index('hub_test_cases_module_idx').on(table.organizationId, table.module),
    index('hub_test_cases_test_id_idx').on(table.testId),
  ],
);

export type HubTestCase = typeof hubTestCases.$inferSelect;
export type InsertHubTestCase = typeof hubTestCases.$inferInsert;

/**
 * A wave of the QA hub: one test session of the QA team (Waves/<wave_id>/wave.json), as the last
 * waves sync read it (shared/hub-waves.ts).
 *
 * `file_hashes` is the content hash of each file of the wave, so a sync re-reads only the waves
 * that changed. `test_plan_id` / `execution_id` are what the wave became when it was imported:
 * one plan and one execution, `triggered_by` 'hub-import', so the dashboard and the reports show
 * it like any run. `materialized_hash` is the content that import was made from.
 */
export const hubWaves = pgTable(
  'hub_waves',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => testCaseSources.id, { onDelete: 'cascade' }),
    waveId: text('wave_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    release: text('release'),
    majorRelease: text('major_release'),
    waveType: text('wave_type'),
    status: text('status'),
    startDate: text('start_date'),
    targetDate: text('target_date'),
    modules: jsonb('modules').$type<string[]>().default([]).notNull(),
    workbookLinks: jsonb('workbook_links').$type<HubWorkbookLink[]>().default([]).notNull(),
    createdByName: text('created_by_name'),
    sourceCreatedAt: timestamp('source_created_at'),
    sourceUpdatedAt: timestamp('source_updated_at'),
    entryCount: integer('entry_count').default(0).notNull(),
    contentHash: text('content_hash').notNull(),
    fileHashes: jsonb('file_hashes').$type<Record<string, string>>().default({}).notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
    missingSince: timestamp('missing_since'),
    testPlanId: text('test_plan_id').references(() => testPlans.id, { onDelete: 'set null' }),
    executionId: text('execution_id').references(() => testPlanExecutions.id, {
      onDelete: 'set null',
    }),
    materializedHash: text('materialized_hash'),
    materializedAt: timestamp('materialized_at'),
    materializedBy: integer('materialized_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    foreignKey({
      name: 'hub_waves_source_id_same_org_fk',
      columns: [table.sourceId, table.organizationId],
      foreignColumns: [testCaseSources.id, testCaseSources.organizationId],
    }),
    foreignKey({
      name: 'hub_waves_test_plan_id_same_org_fk',
      columns: [table.testPlanId, table.organizationId],
      foreignColumns: [testPlans.id, testPlans.organizationId],
    }),
    foreignKey({
      name: 'hub_waves_execution_id_same_org_fk',
      columns: [table.executionId, table.organizationId],
      foreignColumns: [testPlanExecutions.id, testPlanExecutions.organizationId],
    }),
    unique('hub_waves_id_organization_unique').on(table.id, table.organizationId),
    index('hub_waves_organization_id_idx').on(table.organizationId),
    uniqueIndex('hub_waves_source_wave_unique').on(table.sourceId, table.waveId),
    index('hub_waves_execution_id_idx').on(table.executionId),
    index('hub_waves_test_plan_id_idx').on(table.testPlanId),
  ],
);

export type HubWave = typeof hubWaves.$inferSelect;
export type InsertHubWave = typeof hubWaves.$inferInsert;

/**
 * One case of a wave: its entry (module, tester, stage) and the result the QA team recorded,
 * kept as the hub has it — the raw status, every attempt. The WFM status is worked out on import.
 */
export const hubWaveResults = pgTable(
  'hub_wave_results',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    waveRowId: integer('wave_row_id')
      .notNull()
      .references(() => hubWaves.id, { onDelete: 'cascade' }),
    caseId: text('case_id').notNull(),
    rawCaseId: text('raw_case_id').notNull(),
    module: text('module'),
    definitionModule: text('definition_module'),
    assignedTester: text('assigned_tester'),
    stage: text('stage'),
    stageMetrics: jsonb('stage_metrics').$type<Partial<HubStageMetrics>>().default({}).notNull(),
    status: text('status').$type<HubResultStatus>().notNull(),
    executedBy: text('executed_by'),
    executionDate: text('execution_date'),
    buildNumber: text('build_number'),
    bugReference: text('bug_reference'),
    bugPriority: text('bug_priority'),
    notes: text('notes'),
    attempts: jsonb('attempts').$type<HubWaveAttempt[]>().default([]).notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
  },
  (table) => [
    foreignKey({
      name: 'hub_wave_results_wave_row_id_same_org_fk',
      columns: [table.waveRowId, table.organizationId],
      foreignColumns: [hubWaves.id, hubWaves.organizationId],
    }),
    index('hub_wave_results_organization_id_idx').on(table.organizationId),
    uniqueIndex('hub_wave_results_wave_case_unique').on(table.waveRowId, table.caseId),
    index('hub_wave_results_case_idx').on(table.organizationId, table.caseId),
  ],
);

export type HubWaveResultRow = typeof hubWaveResults.$inferSelect;
export type InsertHubWaveResultRow = typeof hubWaveResults.$inferInsert;

export const HUB_JOB_KINDS = ['waves_sync', 'wave_import'] as const;
export type HubJobKind = (typeof HUB_JOB_KINDS)[number];
export const HUB_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type HubJobStatus = (typeof HUB_JOB_STATUSES)[number];

/** Where a job is: what it is on and how far it got. */
export interface HubJobProgress {
  phase?: string;
  done?: number;
  total?: number;
  current?: string | null;
}

/**
 * The long work on a hub source — a waves sync, a wave import — run after the response, with its
 * progress and outcome. At most one queued or running per source.
 */
export const hubJobs = pgTable(
  'hub_jobs',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => testCaseSources.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<HubJobKind>().notNull(),
    status: text('status').$type<HubJobStatus>().default('queued').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().default({}).notNull(),
    progress: jsonb('progress').$type<HubJobProgress>().default({}).notNull(),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    error: text('error'),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    heartbeatAt: timestamp('heartbeat_at'),
    cancelRequestedAt: timestamp('cancel_requested_at'),
  },
  (table) => [
    foreignKey({
      name: 'hub_jobs_source_id_same_org_fk',
      columns: [table.sourceId, table.organizationId],
      foreignColumns: [testCaseSources.id, testCaseSources.organizationId],
    }),
    index('hub_jobs_organization_id_idx').on(table.organizationId),
    index('hub_jobs_source_created_idx').on(table.sourceId, table.createdAt),
    uniqueIndex('hub_jobs_one_live_per_source')
      .on(table.sourceId)
      .where(sql`${table.status} IN ('queued', 'running')`),
  ],
);

export type HubJob = typeof hubJobs.$inferSelect;
export type InsertHubJob = typeof hubJobs.$inferInsert;
