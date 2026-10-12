/** Planning and running: plans, schedules, suites, executions, results, logs, quarantine and the shared work queue. */
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  boolean,
  jsonb,
  index,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { MAX_LOCALES, canonicalLocale, normalizeLocales } from '../locales';
import { canEmulateDevice, isMobileDevice } from '../devices';
import type { MobileRunStatus, MobileStepResult } from '../mobile';
import type { NetworkSummary } from '../network';
import type { FailureAnalysis } from '../failure-analysis';
import type { CiContext } from '../ci';
import type { LoadRunStatus, LoadSummary } from '../load-test';
import { apiTests } from './api-testing';
import { loadTests, mobileTests, tags, tests } from './authoring';
import { browserGrids, environments } from './environments';
import { organizations, projects, users } from './identity';
import { issueTrackers, testManagementConnections } from './integrations';

// Test Plans Table
export const testPlans = pgTable(
  'test_plans',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description'),
    testMachinesConfig: jsonb('test_machines_config'),
    captureScreenshots: text('capture_screenshots').default('on_failed_steps'),
    /**
     * Whether to keep a video of the run, and a Playwright trace of it.
     *
     * A report holds one picture per step and the message the step died with, which answers
     * "the button was not there" and nothing else. A test that failed because a request was
     * slow, or because a dialog appeared and vanished, looks exactly like one with a wrong
     * selector. 'never' | 'on_failure' | 'always'; both default to never, because both cost
     * disk on every run.
     */
    captureVideo: text('capture_video').default('never').notNull(),
    captureTrace: text('capture_trace').default('never').notNull(),
    /** A HAR of each test's requests (no bodies, no credentials) and the summary the report shows. */
    captureNetwork: text('capture_network').default('never').notNull(),
    /** Run on the local agents of this pool (shared/agents.ts); null runs on the server's runners. */
    agentPool: text('agent_pool'),
    /** Run on this browser grid (shared/browser-grids.ts) instead: never together with a pool. */
    browserGridId: text('browser_grid_id').references(() => browserGrids.id, {
      onDelete: 'set null',
    }),
    visualTestingEnabled: boolean('visual_testing_enabled').default(false),
    pageLoadTimeout: integer('page_load_timeout').default(30000),
    elementTimeout: integer('element_timeout').default(30000),
    onMajorStepFailure: text('on_major_step_failure').default('abort_and_run_next_test_case'),
    onAbortedTestCase: text('on_aborted_test_case').default('delete_cookies_and_reuse_session'),
    onTestSuitePreRequisiteFailure: text('on_test_suite_pre_requisite_failure').default(
      'stop_execution',
    ),
    onTestCasePreRequisiteFailure: text('on_test_case_pre_requisite_failure').default(
      'stop_execution',
    ),
    onTestStepPreRequisiteFailure: text('on_test_step_pre_requisite_failure').default(
      'abort_and_run_next_test_case',
    ),
    reRunOnFailure: text('re_run_on_failure').default('none'),
    /**
     * How many of this plan's runs may be in flight at once, across all its browsers.
     *
     * 1 is what every plan did before this existed: one browser session at a time, so forty
     * tests on three browsers were a hundred and twenty of them end to end. How high this can
     * go is a fact about the machine the runner is on, which is why it is a setting and not a
     * constant.
     */
    maxParallelTests: integer('max_parallel_tests').default(1).notNull(),
    /**
     * How many workers may share one run of this plan (server/runtime/run-shards.ts), each running
     * `maxParallelTests` at a time. 1 is one worker, as before this existed (migration 0067).
     */
    shards: integer('shards').default(1).notNull(),
    /** Languages every test runs in, one pass each; empty for the browser's default (migration 0047). */
    locales: jsonb('locales').$type<string[]>().notNull().default([]),
    /**
     * Where this plan's failures are filed, and whether they are filed at all.
     *
     * Off for every plan that exists, and off by default for a new one: filing a bug is an action
     * in somebody else's system, and a feature that starts doing that on its own the moment it is
     * deployed is one nobody forgives. A plan opts in, and names the tracker it opts into.
     */
    issueTrackerId: text('issue_tracker_id').references(() => issueTrackers.id, {
      onDelete: 'set null',
    }),
    /** The TestRail, Xray or Zephyr Scale every finished run is published to (shared/test-management.ts). */
    testManagementId: text('test_management_id').references(
      (): AnyPgColumn => testManagementConnections.id,
      { onDelete: 'set null' },
    ),
    createIssuesOnFailure: boolean('create_issues_on_failure').default(false).notNull(),
    notificationSettings: jsonb('notification_settings'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('test_plans_user_id_idx').on(table.userId),
    index('test_plans_organization_id_idx').on(table.organizationId),
  ],
);

export const testPlanSchedules = pgTable(
  'test_plan_schedules',
  {
    id: text('id').primaryKey(),
    testPlanId: text('test_plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Owner of the schedule; scheduled executions run on behalf of this user.
    // Nullable so pre-existing rows migrate cleanly (the scheduler falls back for them).
    // A removed member's schedules are handed to another member, not deleted (migration 0040).
    userId: integer('user_id').references(() => users.id),
    scheduleName: text('schedule_name').notNull(),
    frequency: text('frequency').notNull(),
    nextRunAt: timestamp('next_run_at').notNull(),
    /**
     * IANA zone the schedule's time is meant in, e.g. 'Europe/Rome'.
     *
     * An offset cannot express "02:00 local all year round", which is what people actually
     * want from a nightly job — and deriving everything from UTC, as this used to, moved such
     * a job by an hour twice a year without anything having changed but the clocks.
     * Defaults to 'UTC', which is what every pre-existing row already meant.
     */
    timezone: text('timezone').notNull().default('UTC'),
    environment: text('environment'),
    browsers: jsonb('browsers'),
    notificationConfigOverride: jsonb('notification_config_override'),
    executionParameters: jsonb('execution_parameters'),
    isActive: boolean('is_active').default(true).notNull(),
    retryOnFailure: text('retry_on_failure').default('none').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('test_plan_schedules_test_plan_id_idx').on(table.testPlanId),
    index('test_plan_schedules_user_id_idx').on(table.userId),
    index('test_plan_schedules_active_next_run_idx').on(table.isActive, table.nextRunAt),
    index('test_plan_schedules_organization_id_idx').on(table.organizationId),
  ],
);

export const testPlanExecutions = pgTable(
  'test_plan_executions',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id').references(() => testPlanSchedules.id, {
      onDelete: 'set null',
    }),
    testPlanId: text('test_plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** Who asked for the run. Null on rows from before this was recorded. */
    requestedByUserId: integer('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('queued'),
    results: jsonb('results'),
    /** When somebody asked for the run. */
    queuedAt: timestamp('queued_at').notNull().defaultNow(),
    /**
     * When a worker began it. Null while it waits: stamping it at enqueue time used to make a run
     * that sat in the queue for ten minutes report ten minutes it never ran for.
     */
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    cancelRequestedAt: timestamp('cancel_requested_at'),
    /** Why a sharded run stopped early under the plan's stop policy, for every worker sharing it (migration 0067). */
    stopReason: text('stop_reason'),
    /** Stamped when a worker takes the run, so "is anyone still on this?" has an answer. */
    heartbeatAt: timestamp('heartbeat_at'),
    /** Why a run ended in `error`: a code to branch on, and a sentence for a person. */
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    /**
     * Every setting the run will use, taken when it was asked for — see server/execution-snapshot.ts.
     * '{}' on rows from before this existed; the worker reads the plan for those.
     */
    configurationSnapshot: jsonb('configuration_snapshot').notNull().default({}),
    /** Chosen by the caller, so asking twice returns the same run. Unique per organization. */
    idempotencyKey: text('idempotency_key'),
    /** Which attempt this run is, out of how many a schedule's retry policy allowed. */
    attempt: integer('attempt').notNull().default(1),
    maxAttempts: integer('max_attempts').notNull().default(1),
    /** The first attempt, on every retry of it. The foreign key is in migration 0023. */
    retryOfExecutionId: text('retry_of_execution_id'),
    /** When retention removed this run's screenshots, videos and traces; the results stay. */
    artifactsPurgedAt: timestamp('artifacts_purged_at'),
    artifactStorageStatus: text('artifact_storage_status').$type<'quota_exceeded' | 'error'>(),
    quotaDeferReason: text('quota_defer_reason').$type<
      'execution_quota_exceeded' | 'concurrent_run_quota'
    >(),
    quotaDeferUntil: timestamp('quota_defer_until'),
    /** The runner that took the run (runners.id, host:pid:suffix). Readable after the runner is gone. */
    runnerId: text('runner_id'),
    /** The build, commit and branch that asked for the run, when a pipeline did — see shared/ci.ts. */
    ciContext: jsonb('ci_context').$type<CiContext>(),
    environment: text('environment'),
    browsers: jsonb('browsers'),
    triggeredBy: text('triggered_by').notNull().default('manual'),
    totalTests: integer('total_tests'),
    passedTests: integer('passed_tests'),
    failedTests: integer('failed_tests'),
    skippedTests: integer('skipped_tests'),
    /** Of the failed and errored tests, those in quarantine: counted, shown, not held against the run. */
    quarantinedFailures: integer('quarantined_failures').notNull().default(0),
    executionDurationMs: integer('execution_duration_ms'),
  },
  (table) => [
    index('test_plan_executions_test_plan_id_idx').on(table.testPlanId),
    index('test_plan_executions_schedule_id_idx').on(table.scheduleId),
    index('test_plan_executions_status_idx').on(table.status),
    index('test_plan_executions_started_at_idx').on(table.startedAt),
    index('test_plan_executions_organization_id_idx').on(table.organizationId),
    index('test_plan_executions_org_run_time_idx').on(
      table.organizationId,
      sql`(coalesce(${table.startedAt}, ${table.queuedAt})) DESC`,
    ),
  ],
);

export const reportTestCaseResults = pgTable(
  'report_test_case_results',
  {
    id: text('id').primaryKey(),
    testPlanExecutionId: text('test_plan_execution_id')
      .notNull()
      .references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    uiTestId: integer('ui_test_id').references(() => tests.id, { onDelete: 'set null' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'set null' }),
    /** A mobile app test's result (migration 0053). Plain integer here: mobile_tests is declared further down. */
    mobileTestId: integer('mobile_test_id'),
    testType: text('test_type').notNull(),
    testName: text('test_name').notNull(),
    /**
     * The browser this result came from, as the plan or schedule named it.
     *
     * A plan that asks for two browsers produces two rows per test, and without this they read
     * as the same test disagreeing with itself. Null on rows written before runs covered more
     * than one browser.
     */
    browser: text('browser'),
    /**
     * Which version of the test this result came from — see `testVersions`.
     *
     * The history of a test and the runs of it existed side by side and were never connected, so
     * "did the application change, or did the test?" had no answer in the data. Null on every row
     * written before this was recorded, and on API tests, which have no version history: a result
     * that does not know its version says so rather than claiming version 1.
     */
    testVersion: integer('test_version'),
    status: text('status').notNull(),
    /**
     * How many times the test ran in this run before this result stood: more than one when the
     * plan re-runs failed tests. A pass with attempts > 1 is a flaky test, which is a finding of
     * its own and not the same thing as a pass.
     */
    attempts: integer('attempts').notNull().default(1),
    /**
     * The test was in quarantine when it ran (see `testQuarantines`): its failure is recorded and
     * shown, and did not count against the run.
     */
    quarantined: boolean('quarantined').notNull().default(false),
    reasonForFailure: text('reason_for_failure'),
    screenshotUrl: text('screenshot_url'),
    /**
     * A recording of the run, and a Playwright trace of it, when the plan asked to keep them.
     *
     * The trace is the one that answers questions a screenshot cannot: it carries the DOM, the
     * network and the console at every step, and opens in Playwright's own viewer.
     */
    videoUrl: text('video_url'),
    traceUrl: text('trace_url'),
    /** The kept HAR, when the plan keeps one for this outcome. */
    harUrl: text('har_url'),
    /** Failed and slow requests, read from the HAR whenever one was recorded — see shared/network.ts. */
    networkSummary: jsonb('network_summary').$type<NetworkSummary>(),
    /** What the AI made of this failure, once somebody asked — see shared/failure-analysis.ts. */
    aiAnalysis: jsonb('ai_analysis').$type<FailureAnalysis>(),
    detailedLog: text('detailed_log'),
    startedAt: timestamp('started_at').notNull(),
    completedAt: timestamp('completed_at'),
    durationMs: integer('duration_ms'),
    module: text('module'),
    featureArea: text('feature_area'),
    scenario: text('scenario'),
    component: text('component'),
    priority: text('priority'),
    severity: text('severity'),
  },
  (table) => [
    index('report_test_case_results_execution_id_idx').on(table.testPlanExecutionId),
    index('report_test_case_results_ui_test_id_idx').on(table.uiTestId),
    index('report_test_case_results_api_test_id_idx').on(table.apiTestId),
    index('report_test_case_results_organization_id_idx').on(table.organizationId),
  ],
);

// ─── Execution Logs (User-Facing Console) ─────────────────────────────────────
// Stores structured log entries emitted during test plan execution.
// Queried by the frontend log console and streamed live via WebSocket.
export const executionLogs = pgTable(
  'execution_logs',
  {
    id: serial('id').primaryKey(),
    testPlanExecutionId: text('test_plan_execution_id')
      .notNull()
      .references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
    level: text('level').notNull(), // 'info' | 'warn' | 'error' | 'step' | 'debug'
    source: text('source').notNull(), // 'playwright' | 'api-runner' | 'system' | 'worker'
    message: text('message').notNull(),
    metadata: jsonb('metadata'), // Step details, screenshots, timing, etc.
    testCaseResultId: text('test_case_result_id'), // Optional link to a specific test case
    correlationId: text('correlation_id'),
  },
  (table) => [
    index('execution_logs_execution_id_idx').on(table.testPlanExecutionId),
    index('execution_logs_correlation_id_idx').on(table.correlationId),
    index('execution_logs_organization_id_idx').on(table.organizationId),
  ],
);

export const testPlanWebhooks = pgTable(
  'test_plan_webhooks',
  {
    id: serial('id').primaryKey(),
    testPlanId: text('test_plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /**
     * SHA-256 of the token, which is all that is kept — see server/webhook-tokens.ts. The token
     * itself was stored as it was, so anyone who could read this table could start any plan.
     */
    tokenHash: text('token_hash').notNull().unique(),
    /** The first characters of the token, to tell two webhooks apart in a list. */
    tokenPrefix: text('token_prefix').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at'),
  },
  (table) => [
    index('test_plan_webhooks_test_plan_id_idx').on(table.testPlanId),
    index('test_plan_webhooks_organization_id_idx').on(table.organizationId),
  ],
);

export const testPlanSelectedTests = pgTable(
  'test_plan_selected_tests',
  {
    id: serial('id').primaryKey(),
    testPlanId: text('test_plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    /** A mobile app test in the plan (migration 0053); testType 'mobile'. */
    mobileTestId: integer('mobile_test_id'),
    testType: text('test_type').notNull(),
  },
  (table) => [
    index('test_plan_selected_tests_test_plan_id_idx').on(table.testPlanId),
    index('test_plan_selected_tests_test_id_idx').on(table.testId),
    index('test_plan_selected_tests_api_test_id_idx').on(table.apiTestId),
    index('test_plan_selected_tests_organization_id_idx').on(table.organizationId),
  ],
);

/**
 * The work of a run shared by several workers (server/runtime/run-shards.ts): one item per test of a
 * browser and language, or per browser and language when its API tests pass values on. Claimed
 * one at a time; a claim whose heartbeat stops is taken back (migration 0067).
 */
export const runWorkItems = pgTable(
  'run_work_items',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    key: text('key').notNull(),
    position: integer('position').notNull(),
    unit: jsonb('unit').notNull(),
    state: text('state').$type<'pending' | 'claimed' | 'done'>().notNull().default('pending'),
    claimedBy: text('claimed_by'),
    heartbeatAt: timestamp('heartbeat_at'),
    finishedAt: timestamp('finished_at'),
    error: text('error'),
    results: jsonb('results'),
  },
  (table) => [
    primaryKey({ columns: [table.executionId, table.key] }),
    index('run_work_items_organization_id_idx').on(table.organizationId),
  ],
);

export type RunWorkItem = typeof runWorkItems.$inferSelect;

/**
 * Which tests a change affects (server/test-impact.ts): the files a glob pattern matches map to a
 * tag. A rule without a tag marks files that affect no test (migration 0068).
 */
export const impactRules = pgTable(
  'impact_rules',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    pattern: text('pattern').notNull(),
    tagId: text('tag_id').references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('impact_rules_organization_id_idx').on(table.organizationId)],
);

export type ImpactRule = typeof impactRules.$inferSelect;

export const TEST_SUITE_KINDS = ['static', 'dynamic'] as const;
export type TestSuiteKind = (typeof TEST_SUITE_KINDS)[number];

/**
 * A named set of tests that plans share: chosen one by one (static), or every test carrying some
 * tags (dynamic, worked out when a run is created). See migrations/0034.
 */
export const testSuites = pgTable(
  'test_suites',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').$type<TestSuiteKind>().notNull().default('static'),
    /** The dynamic rule: tags a test must all carry. */
    tagIds: jsonb('tag_ids').$type<string[]>().notNull().default([]),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('test_suites_organization_id_idx').on(table.organizationId)],
);

export type TestSuite = typeof testSuites.$inferSelect;

/** The tests of a static suite, in order. */
export const testSuiteItems = pgTable(
  'test_suite_items',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    suiteId: integer('suite_id')
      .notNull()
      .references(() => testSuites.id, { onDelete: 'cascade' }),
    testType: text('test_type').$type<'ui' | 'api' | 'mobile'>().notNull(),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    /** A mobile app test (migration 0054). Plain integer here: mobile_tests is declared further down. */
    mobileTestId: integer('mobile_test_id'),
    position: integer('position').notNull(),
  },
  (table) => [index('test_suite_items_suite_id_idx').on(table.suiteId)],
);

/** The suites a plan includes, in order, after its own tests. */
export const testPlanSuites = pgTable(
  'test_plan_suites',
  {
    testPlanId: text('test_plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    suiteId: integer('suite_id')
      .notNull()
      .references(() => testSuites.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.testPlanId, table.suiteId] }),
    index('test_plan_suites_suite_id_idx').on(table.suiteId),
  ],
);

/**
 * A test set aside while it is unreliable: it still runs, and its result is still recorded, but
 * its failures do not fail the run, stop the plan, file issues or break a pipeline. One row per
 * time a test was quarantined; the open one has no releasedAt. See migrations/0035.
 */
export const testQuarantines = pgTable(
  'test_quarantines',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testType: text('test_type').$type<'ui' | 'api' | 'mobile'>().notNull(),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    /** A mobile app test (migration 0058). Plain integer here: mobile_tests is declared further down. */
    mobileTestId: integer('mobile_test_id'),
    /** Why, in words: the thing whoever releases it will want to know was dealt with. */
    reason: text('reason').notNull(),
    quarantinedBy: integer('quarantined_by').references(() => users.id, { onDelete: 'set null' }),
    quarantinedAt: timestamp('quarantined_at').defaultNow().notNull(),
    releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at'),
    releaseNote: text('release_note'),
  },
  (table) => [index('test_quarantines_organization_id_idx').on(table.organizationId)],
);

export type TestQuarantine = typeof testQuarantines.$inferSelect;

/** One run of a mobile test on a grid's device. */
export const mobileTestRuns = pgTable(
  'mobile_test_runs',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    mobileTestId: integer('mobile_test_id')
      .notNull()
      .references(() => mobileTests.id, { onDelete: 'cascade' }),
    gridId: text('grid_id').references(() => browserGrids.id, { onDelete: 'set null' }),
    environmentId: integer('environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    testVersion: integer('test_version'),
    testSnapshot: jsonb('test_snapshot').$type<Record<string, unknown>>(),
    status: text('status').$type<MobileRunStatus>().notNull(),
    device: text('device').notNull(),
    steps: jsonb('steps').$type<MobileStepResult[]>().notNull().default([]),
    error: text('error'),
    screenshot: text('screenshot'),
    artifactStorageStatus: text('artifact_storage_status').$type<'quota_exceeded' | 'error'>(),
    sessionUrl: text('session_url'),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('mobile_test_runs_test_idx').on(table.mobileTestId, table.createdAt)],
);

export type MobileTestRun = typeof mobileTestRuns.$inferSelect;

/** One run of a load test: its live summary while it runs, its verdict once it is over. */
export const loadTestRuns = pgTable(
  'load_test_runs',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    loadTestId: integer('load_test_id')
      .notNull()
      .references(() => loadTests.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    environmentId: integer('environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<LoadRunStatus>().notNull(),
    /** The definition as it was when the run started: the test may change while it runs. */
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    summary: jsonb('summary').$type<LoadSummary>(),
    error: text('error'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    /** Written with every progress and heartbeat: a running run whose heartbeat stopped is lost. */
    heartbeatAt: timestamp('heartbeat_at'),
    /** The BullMQ job on the load queue that executes it (server/queue.ts, loadQueue). */
    jobId: text('job_id'),
    /** The worker process that took it: host and pid. */
    workerId: text('worker_id'),
    /** When it was asked for; startedAt is when a worker took it. */
    queuedAt: timestamp('queued_at'),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    index('load_test_runs_test_idx').on(table.loadTestId, table.startedAt),
    index('load_test_runs_status_idx').on(table.organizationId, table.status),
  ],
);

export type LoadTestRun = typeof loadTestRuns.$inferSelect;

// OS and versions are optional: the runners cannot choose them (server/runtime/browsers.ts says so in
// the run's log), and the plan settings dialog sends only what applies — a browser grid is where
// they mean something. Required, they made the dialog's every save of its browsers a 400.
const TestMachineConfigSchema = z
  .object({
    os: z.string().max(60).optional().nullable(),
    osVersion: z.string().max(60).optional().nullable(),
    browserName: z.string(),
    browserVersion: z.string().max(60).optional().nullable(),
    headless: z.boolean(),
    /** A phone or tablet to emulate (shared/devices.ts); empty for the desktop. */
    device: z
      .string()
      .max(60)
      .refine((name) => isMobileDevice(name), {
        message: 'Not a device this installation can emulate.',
      })
      .optional()
      .nullable(),
  })
  .refine((machine) => !machine.device || canEmulateDevice(machine.browserName), {
    message:
      'Firefox cannot emulate a phone or a tablet: choose Chromium, Chrome, Edge or WebKit for it.',
    path: ['device'],
  })
  .optional();

/**
 * When a run's video and trace are kept.
 *
 * 'on_failure' still records — Playwright writes a video when the context closes and cannot
 * be asked for one afterwards — and decides only whether the file survives the run.
 */
export const EVIDENCE_CAPTURE_MODES = ['never', 'on_failure', 'always'] as const;
export type EvidenceCaptureMode = (typeof EVIDENCE_CAPTURE_MODES)[number];

export const insertTestPlanSchema = createInsertSchema(testPlans, {
  name: z.string().min(1, 'Test Plan Name is required'),
  description: z.string().optional(),
  testMachinesConfig: z.array(TestMachineConfigSchema).optional().nullable(),
  captureScreenshots: z.enum(['always', 'on_failed_steps', 'never']).default('on_failed_steps'),
  // Kept in their own vocabulary rather than reusing the screenshots one: a video is of the
  // run, not of a step, so "on failed steps" would be a promise neither can keep.
  captureVideo: z.enum(EVIDENCE_CAPTURE_MODES).default('never'),
  captureTrace: z.enum(EVIDENCE_CAPTURE_MODES).default('never'),
  captureNetwork: z.enum(EVIDENCE_CAPTURE_MODES).default('never'),
  // A pool of local agents, or null for the server's own runners.
  agentPool: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'A pool name is lowercase letters, digits, - and _')
    .nullable()
    .optional(),
  visualTestingEnabled: z.boolean().default(false),
  // Milliseconds. A second at least: the wizard once sent seconds here, and a value that small
  // is that mistake, not a timeout anybody wants.
  pageLoadTimeout: z.number().int().min(1000).max(600000).default(30000),
  elementTimeout: z.number().int().min(1000).max(600000).default(30000),
  onMajorStepFailure: z
    .enum(['abort_and_run_next_test_case', 'stop_execution', 'retry_step'])
    .default('abort_and_run_next_test_case'),
  onAbortedTestCase: z
    .enum(['delete_cookies_and_reuse_session', 'stop_execution'])
    .default('delete_cookies_and_reuse_session'),
  onTestSuitePreRequisiteFailure: z
    .enum(['stop_execution', 'skip_test_suite', 'continue_anyway'])
    .default('stop_execution'),
  onTestCasePreRequisiteFailure: z
    .enum(['stop_execution', 'skip_test_case', 'continue_anyway'])
    .default('stop_execution'),
  onTestStepPreRequisiteFailure: z
    .enum(['abort_and_run_next_test_case', 'stop_execution', 'skip_test_step'])
    .default('abort_and_run_next_test_case'),
  reRunOnFailure: z.enum(['none', 'once', 'twice', 'thrice']).default('none'),
  // Capped rather than open: each unit is a real browser, and a number typed into a form is
  // not a statement about how much memory the runner has.
  maxParallelTests: z.number().int().min(1).max(16).default(1),
  // Workers sharing one run; each is a runner process, so the cap is small (migration 0067).
  shards: z.number().int().min(1).max(8).default(1),
  // The languages each test runs in (shared/locales.ts). Refused by name rather than dropped:
  // "english" silently becoming no language at all would be a run in the browser's default.
  locales: z
    .array(
      z
        .string()
        .trim()
        .refine((value) => canonicalLocale(value) !== null, {
          message: 'A language is a code such as it, it-IT or en-US',
        }),
    )
    .max(MAX_LOCALES)
    .transform((list) => normalizeLocales(list))
    .default([]),
  notificationSettings: z
    .object({
      passed: z.boolean().default(true),
      failed: z.boolean().default(true),
      notExecuted: z.boolean().default(true),
      stopped: z.boolean().default(true),
      /**
       * Where those four switches send to.
       *
       * They had no destination until now, which is why a plan set to notify on failure
       * notified nobody. Zod strips what it does not declare, so this has to be named here
       * for the wizard's value to survive as far as the column.
       */
      webhookUrl: z
        .string()
        .trim()
        .refine((value) => value === '' || /^https?:\/\//i.test(value), {
          message: 'Notification webhook URL must start with http:// or https://',
        })
        .nullable()
        .optional(),
    })
    .optional()
    .nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // The tenancy boundary: never accepted from the client, always derived server-side
  // from the authenticated session.
  organizationId: true,
  // Same reasoning as organizationId: the owning user is derived from the authenticated
  // session (req.user.id), never trusted from the request body.
  userId: true,
});

export const selectTestPlanSchema = createSelectSchema(testPlans);
export const updateTestPlanSchema = insertTestPlanSchema.partial();

// Test plan create/update payloads also carry the set of tests to link, which live in a
// separate join table (testPlanSelectedTests) rather than as a column on testPlans.
// Shared here so every route that accepts a test-plan payload (currently
// server/routes/test-plans.routes.ts and server/routes.ts) validates against the same
// shape instead of maintaining duplicate, possibly-drifting copies.
export const testPlanApiPayloadSchema = insertTestPlanSchema.extend({
  selectedTests: z
    .array(
      z.object({
        id: z.number().int(), // tests.id, apiTests.id or mobileTests.id
        type: z.enum(['ui', 'api', 'mobile']),
      }),
    )
    .optional()
    .default([]),
});

export const updateTestPlanApiPayloadSchema = updateTestPlanSchema.extend({
  selectedTests: z
    .array(
      z.object({
        id: z.number().int(),
        type: z.enum(['ui', 'api', 'mobile']),
      }),
    )
    .optional(), // On update, if not provided, selected tests are not changed. If an empty array is provided, all are removed.
});

export type TestPlan = typeof testPlans.$inferSelect;
export type InsertTestPlan = typeof testPlans.$inferInsert;
export type TestPlanSelectedTest = typeof testPlanSelectedTests.$inferSelect;
export type InsertTestPlanSelectedTest = typeof testPlanSelectedTests.$inferInsert;

export const insertTestPlanScheduleSchema = createInsertSchema(testPlanSchedules, {
  nextRunAt: z.number().positive().or(z.date()),
  browsers: z.array(z.string()).optional().nullable(),
  notificationConfigOverride: z.record(z.any()).optional().nullable(),
  executionParameters: z.record(z.any()).optional().nullable(),
  isActive: z.boolean().default(true),
  retryOnFailure: z.enum(['none', 'once', 'twice']).default('none'),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // The tenancy boundary: never accepted from the client, always derived server-side
  // from the authenticated session.
  organizationId: true,
  // Same category as organizationId. POST already overrode a body-supplied userId after
  // the spread, but PUT did not — so a schedule's owner was wire-writable, and
  // scheduler-service.ts then ran the plan on behalf of whoever the body named.
  userId: true,
});

export const selectTestPlanScheduleSchema = createSelectSchema(testPlanSchedules);
export const updateTestPlanScheduleSchema = insertTestPlanScheduleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type TestPlanSchedule = typeof testPlanSchedules.$inferSelect;
export type InsertTestPlanSchedule = typeof testPlanSchedules.$inferInsert;

export const insertTestPlanExecutionSchema = createInsertSchema(testPlanExecutions, {
  results: z.any().optional().nullable(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional().nullable(),
  browsers: z.array(z.string()).optional().nullable(),
  totalTests: z.number().int().optional().nullable(),
  passedTests: z.number().int().optional().nullable(),
  failedTests: z.number().int().optional().nullable(),
  skippedTests: z.number().int().optional().nullable(),
  executionDurationMs: z.number().int().optional().nullable(),
}).omit({ id: true });

export const selectTestPlanExecutionSchema = createSelectSchema(testPlanExecutions);

export type TestPlanExecution = typeof testPlanExecutions.$inferSelect;
export type InsertTestPlanExecution = typeof testPlanExecutions.$inferInsert;

// ---- ZOD SCHEMAS AND TYPES for reportTestCaseResults ----
export const insertReportTestCaseResultSchema = createInsertSchema(reportTestCaseResults, {
  startedAt: z.number(),
  completedAt: z.number().optional().nullable(),
  durationMs: z.number().int().optional().nullable(),
  status: z.enum(['Passed', 'Failed', 'Skipped', 'Pending', 'Error']),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional().nullable(),
  severity: z.enum(['Blocker', 'Critical', 'Major', 'Minor']).optional().nullable(),
  module: z.string().optional().nullable(),
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
}).omit({ id: true });

export const selectReportTestCaseResultSchema = createSelectSchema(reportTestCaseResults);

export type ReportTestCaseResult = typeof reportTestCaseResults.$inferSelect;
export type InsertReportTestCaseResult = typeof reportTestCaseResults.$inferInsert;

export type ExecutionLog = typeof executionLogs.$inferSelect;
export type InsertExecutionLog = typeof executionLogs.$inferInsert;
export type TestPlanWebhook = typeof testPlanWebhooks.$inferSelect;
export type InsertTestPlanWebhook = typeof testPlanWebhooks.$inferInsert;
