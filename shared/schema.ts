import { pgTable, text, integer, bigint, serial, timestamp, boolean, jsonb, index, unique, primaryKey } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations } from 'drizzle-orm';
import { ACTION_REQUIREMENTS, ADHOC_ACTION_IDS, STEP_GROUP_ACTION_ID } from './recording';

// Table Definitions
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * This organization's share of the execution plane — see server/tenant-quotas.ts. Null is the
   * installation's default. Set by the operator; the application has no grant to change them.
   */
  maxConcurrentRuns: integer("max_concurrent_runs"),
  maxQueuedRuns: integer("max_queued_runs"),
  /** Every member signing in with a password must use a second factor. Keys are not affected. */
  mfaRequired: boolean("mfa_required").notNull().default(false),
  /** Publishing a test needs another member's approval, and plans run published tests only. */
  testReviewRequired: boolean("test_review_required").notNull().default(false),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // The tenancy boundary. One user belongs to exactly one organization.
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  // Verbs, not rows: RLS decides which rows are visible, this decides what may be done to them.
  role: text("role").notNull().default('editor'),
  /** 'person' signs in with a password; 'service' never signs in and exists to hold API keys. */
  kind: text("kind").notNull().default('person'),
  /** What a service account is called. Its username is generated, being unique across organizations. */
  displayName: text("display_name"),
  /** A disabled service account keeps its row, so the runs it started still name it. */
  disabledAt: timestamp("disabled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * A user's second factor. Its own table so no secret rides along on the user row, which goes
 * everywhere (session, /api/user, req.user). Reached only through server/mfa.ts; app_user has
 * no grant on it. See migrations/0030_mfa_totp.sql.
 */
export const userMfa = pgTable("user_mfa", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text("secret_encrypted"),
  secretIv: text("secret_iv"),
  secretAuthTag: text("secret_auth_tag"),
  pendingSecretEncrypted: text("pending_secret_encrypted"),
  pendingSecretIv: text("pending_secret_iv"),
  pendingSecretAuthTag: text("pending_secret_auth_tag"),
  enabledAt: timestamp("enabled_at"),
  lastUsedStep: bigint("last_used_step", { mode: 'number' }),
  /** SHA-256 hashes of the unused recovery codes. */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userSettings = pgTable("user_settings", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  theme: text("theme").default('light').notNull(),
  defaultTestUrl: text("default_test_url"),
  playwrightBrowser: text("playwright_browser").default('chromium').notNull(),
  playwrightHeadless: boolean("playwright_headless").default(true).notNull(),
  playwrightDefaultTimeout: integer("playwright_default_timeout").default(30000).notNull(),
  playwrightWaitTime: integer("playwright_wait_time").default(1000).notNull(),
  language: text("language").default('en').notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * Visible only to the organization's owners and the project's members (project_members), who
   * may edit it only as editors there. Enforced by RLS — see migrations/0031_project_access.sql.
   */
  restricted: boolean("restricted").notNull().default(false),
}, (table) => [
  index("projects_user_id_idx").on(table.userId),
  index("projects_organization_id_idx").on(table.organizationId),
]);

/**
 * Who is on a restricted project, and as what. A project role only ever narrows the
 * organization role: an organization viewer who is an editor here is still a viewer.
 */
export const projectMembers = pgTable("project_members", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  /** 'viewer' | 'editor' */
  role: text("role").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
  index("project_members_organization_id_idx").on(table.organizationId),
  index("project_members_user_id_idx").on(table.userId),
]);

export type ProjectMember = typeof projectMembers.$inferSelect;

export const tests = pgTable("tests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sequence: jsonb("sequence").notNull(),
  elements: jsonb("elements").notNull(),
  // Ordered API setup calls that must succeed before the UI sequence runs, so the
  // system under test is in the required state (e.g. a static scale check before a
  // tare check). Nullable: existing/most tests have none. See PreconditionSchema.
  preconditions: jsonb("preconditions"),
  /**
   * Rows of input this test runs over, one run each.
   *
   * Each key becomes a {{variable}} for that run, layered over the environment values.
   * Null or empty means one run with no extra variables — what every test did before.
   */
  dataset: jsonb("dataset"),
  status: text("status").notNull().default("draft"),
  /**
   * The version plans run (test_versions.version). Null: never published, and plans run this
   * row — the working copy — as they always did. See migrations/0032_test_publishing.sql.
   */
  publishedVersion: integer("published_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // NEW Fields for reporting
  module: text("module"),
  featureArea: text("feature_area"),
  scenario: text("scenario"),
  component: text("component"),
  priority: text("priority").default('Medium'), // enum is handled by app logic/zod
  severity: text("severity").default('Major'),
}, (table) => [
  index("tests_user_id_idx").on(table.userId),
  index("tests_project_id_idx").on(table.projectId),
  index("tests_status_idx").on(table.status),
  index("tests_organization_id_idx").on(table.organizationId),
]);

export const testRuns = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => tests.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  status: text("status").notNull(),
  results: jsonb("results"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("test_runs_test_id_idx").on(table.testId),
  index("test_runs_organization_id_idx").on(table.organizationId),
]);

export const detectedElements = pgTable("detected_elements", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => tests.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  elementId: text("element_id").notNull(), // Client-side ID like elem-button-1
  selector: text("selector").notNull(),
  originalSelector: text("original_selector"),
  type: text("type"),
  text: text("text"),
  tag: text("tag"),
  attributes: jsonb("attributes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("detected_elements_test_id_idx").on(table.testId),
  index("detected_elements_test_id_element_id_idx").on(table.testId, table.elementId),
  index("detected_elements_organization_id_idx").on(table.organizationId),
]);

export const apiTestHistory = pgTable("api_test_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  method: text("method").notNull(),
  url: text("url").notNull(),
  queryParams: jsonb("query_params"),
  requestHeaders: jsonb("request_headers"),
  requestBody: text("request_body"),
  responseStatus: integer("response_status"),
  responseHeaders: jsonb("response_headers"),
  responseBody: text("response_body"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("api_test_history_user_id_idx").on(table.userId),
  index("api_test_history_organization_id_idx").on(table.organizationId),
]);

export const apiTests = pgTable("api_tests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  method: text("method").notNull(),
  url: text("url").notNull(),
  queryParams: jsonb("query_params"),
  requestHeaders: jsonb("request_headers"),
  requestBody: text("request_body"),
  assertions: jsonb("assertions"),
  /**
   * Values to capture from the response for later requests in the same plan run.
   *
   * Assertions could read a response but nothing could take a value out of one, so a test
   * could only check one endpoint in isolation — never a flow. See ExtractionSchema.
   */
  extractions: jsonb('extractions'),
  authType: text("auth_type"),
  authParams: jsonb("auth_params"),
  bodyType: text("body_type"),
  bodyRawContentType: text("body_raw_content_type"),
  bodyFormData: jsonb("body_form_data"),
  bodyUrlEncoded: jsonb("body_url_encoded"),
  bodyGraphqlQuery: text("body_graphql_query"),
  bodyGraphqlVariables: text("body_graphql_variables"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // NEW Fields for reporting
  module: text("module"),
  featureArea: text("feature_area"),
  scenario: text("scenario"),
  component: text("component"),
  priority: text("priority").default('Medium'),
  severity: text("severity").default('Major'),
}, (table) => [
  index("api_tests_user_id_idx").on(table.userId),
  index("api_tests_project_id_idx").on(table.projectId),
  index("api_tests_organization_id_idx").on(table.organizationId),
]);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

/**
 * The worker processes that run plans, as they describe themselves. Installation-wide and
 * outside RLS, like system_settings; see migrations/0033_runner_registry.sql.
 */
export const runners = pgTable('runners', {
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
}, (table) => [
  index('runners_last_seen_at_idx').on(table.lastSeenAt),
]);

export type Runner = typeof runners.$inferSelect;

// Test Plans Table
export const testPlans = pgTable("test_plans", {
  id: text('id').primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
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
  visualTestingEnabled: boolean('visual_testing_enabled').default(false),
  pageLoadTimeout: integer('page_load_timeout').default(30000),
  elementTimeout: integer('element_timeout').default(30000),
  onMajorStepFailure: text('on_major_step_failure').default('abort_and_run_next_test_case'),
  onAbortedTestCase: text('on_aborted_test_case').default('delete_cookies_and_reuse_session'),
  onTestSuitePreRequisiteFailure: text('on_test_suite_pre_requisite_failure').default('stop_execution'),
  onTestCasePreRequisiteFailure: text('on_test_case_pre_requisite_failure').default('stop_execution'),
  onTestStepPreRequisiteFailure: text('on_test_step_pre_requisite_failure').default('abort_and_run_next_test_case'),
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
   * Where this plan's failures are filed, and whether they are filed at all.
   *
   * Off for every plan that exists, and off by default for a new one: filing a bug is an action
   * in somebody else's system, and a feature that starts doing that on its own the moment it is
   * deployed is one nobody forgives. A plan opts in, and names the tracker it opts into.
   */
  issueTrackerId: text('issue_tracker_id').references(() => issueTrackers.id, { onDelete: 'set null' }),
  createIssuesOnFailure: boolean('create_issues_on_failure').default(false).notNull(),
  notificationSettings: jsonb('notification_settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index("test_plans_user_id_idx").on(table.userId),
  index("test_plans_organization_id_idx").on(table.organizationId),
]);

export const testPlanSchedules = pgTable("test_plan_schedules", {
  id: text('id').primaryKey(),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  // Owner of the schedule; scheduled executions run on behalf of this user.
  // Nullable so pre-existing rows migrate cleanly (the scheduler falls back for them).
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
}, (table) => [
  index("test_plan_schedules_test_plan_id_idx").on(table.testPlanId),
  index("test_plan_schedules_user_id_idx").on(table.userId),
  index("test_plan_schedules_active_next_run_idx").on(table.isActive, table.nextRunAt),
  index("test_plan_schedules_organization_id_idx").on(table.organizationId),
]);

// The run's states live in shared/execution-status.ts so the client can share them without
// importing the database layer. Which state may follow which lives in server/execution-state.ts,
// and every write of `status` goes through it.
export {
  EXECUTION_STATUSES,
  IN_FLIGHT_EXECUTION_STATUSES,
  isExecutionInFlight,
  type ExecutionStatus,
  type ExecutionTrigger,
} from './execution-status';

export const testPlanExecutions = pgTable("test_plan_executions", {
  id: text('id').primaryKey(),
  scheduleId: text('schedule_id').references(() => testPlanSchedules.id, { onDelete: 'set null' }),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  /** Who asked for the run. Null on rows from before this was recorded. */
  requestedByUserId: integer('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('queued'),
  results: jsonb("results"),
  /** When somebody asked for the run. */
  queuedAt: timestamp('queued_at').notNull().defaultNow(),
  /**
   * When a worker began it. Null while it waits: stamping it at enqueue time used to make a run
   * that sat in the queue for ten minutes report ten minutes it never ran for.
   */
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  cancelRequestedAt: timestamp('cancel_requested_at'),
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
  /** The runner that took the run (runners.id, host:pid:suffix). Readable after the runner is gone. */
  runnerId: text('runner_id'),
  environment: text('environment'),
  browsers: jsonb('browsers'),
  triggeredBy: text('triggered_by').notNull().default('manual'),
  totalTests: integer("total_tests"),
  passedTests: integer("passed_tests"),
  failedTests: integer("failed_tests"),
  skippedTests: integer("skipped_tests"),
  executionDurationMs: integer("execution_duration_ms"),
}, (table) => [
  index("test_plan_executions_test_plan_id_idx").on(table.testPlanId),
  index("test_plan_executions_schedule_id_idx").on(table.scheduleId),
  index("test_plan_executions_status_idx").on(table.status),
  index("test_plan_executions_started_at_idx").on(table.startedAt),
  index("test_plan_executions_organization_id_idx").on(table.organizationId),
]);

export const reportTestCaseResults = pgTable("report_test_case_results", {
  id: text("id").primaryKey(),
  testPlanExecutionId: text("test_plan_execution_id").notNull().references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  uiTestId: integer("ui_test_id").references(() => tests.id, { onDelete: 'set null' }),
  apiTestId: integer("api_test_id").references(() => apiTests.id, { onDelete: 'set null' }),
  testType: text("test_type").notNull(),
  testName: text("test_name").notNull(),
  /**
   * The browser this result came from, as the plan or schedule named it.
   *
   * A plan that asks for two browsers produces two rows per test, and without this they read
   * as the same test disagreeing with itself. Null on rows written before runs covered more
   * than one browser.
   */
  browser: text("browser"),
  /**
   * Which version of the test this result came from — see `testVersions`.
   *
   * The history of a test and the runs of it existed side by side and were never connected, so
   * "did the application change, or did the test?" had no answer in the data. Null on every row
   * written before this was recorded, and on API tests, which have no version history: a result
   * that does not know its version says so rather than claiming version 1.
   */
  testVersion: integer("test_version"),
  status: text("status").notNull(),
  /**
   * How many times the test ran in this run before this result stood: more than one when the
   * plan re-runs failed tests. A pass with attempts > 1 is a flaky test, which is a finding of
   * its own and not the same thing as a pass.
   */
  attempts: integer("attempts").notNull().default(1),
  reasonForFailure: text("reason_for_failure"),
  screenshotUrl: text("screenshot_url"),
  /**
   * A recording of the run, and a Playwright trace of it, when the plan asked to keep them.
   *
   * The trace is the one that answers questions a screenshot cannot: it carries the DOM, the
   * network and the console at every step, and opens in Playwright's own viewer.
   */
  videoUrl: text("video_url"),
  traceUrl: text("trace_url"),
  detailedLog: text("detailed_log"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  module: text("module"),
  featureArea: text("feature_area"),
  scenario: text("scenario"),
  component: text("component"),
  priority: text("priority"),
  severity: text("severity"),
}, (table) => [
  index("report_test_case_results_execution_id_idx").on(table.testPlanExecutionId),
  index("report_test_case_results_ui_test_id_idx").on(table.uiTestId),
  index("report_test_case_results_api_test_id_idx").on(table.apiTestId),
  index("report_test_case_results_organization_id_idx").on(table.organizationId),
]);

// ─── Execution Logs (User-Facing Console) ─────────────────────────────────────
// Stores structured log entries emitted during test plan execution.
// Queried by the frontend log console and streamed live via WebSocket.
export const executionLogs = pgTable("execution_logs", {
  id: serial('id').primaryKey(),
  testPlanExecutionId: text('test_plan_execution_id').notNull()
    .references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  level: text('level').notNull(),               // 'info' | 'warn' | 'error' | 'step' | 'debug'
  source: text('source').notNull(),             // 'playwright' | 'api-runner' | 'system' | 'worker'
  message: text('message').notNull(),
  metadata: jsonb('metadata'),                  // Step details, screenshots, timing, etc.
  testCaseResultId: text('test_case_result_id'), // Optional link to a specific test case
  correlationId: text('correlation_id'),
}, (table) => [
  index("execution_logs_execution_id_idx").on(table.testPlanExecutionId),
  index("execution_logs_correlation_id_idx").on(table.correlationId),
  index("execution_logs_organization_id_idx").on(table.organizationId),
]);

export const environments = pgTable("environments", {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
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
}, (table) => [
  index("environments_user_id_idx").on(table.userId),
  index("environments_organization_id_idx").on(table.organizationId),
]);

export const secrets = pgTable("secrets", {
  id: serial('id').primaryKey(),
  environmentId: integer('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  keyName: text('key_name').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index("secrets_environment_id_idx").on(table.environmentId),
  index("secrets_user_id_idx").on(table.userId),
  index("secrets_organization_id_idx").on(table.organizationId),
]);

export const testPlanWebhooks = pgTable("test_plan_webhooks", {
  id: serial('id').primaryKey(),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
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
}, (table) => [
  index("test_plan_webhooks_test_plan_id_idx").on(table.testPlanId),
  index("test_plan_webhooks_organization_id_idx").on(table.organizationId),
]);

export const testPlanSelectedTests = pgTable("test_plan_selected_tests", {
  id: serial('id').primaryKey(),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
  testType: text('test_type').notNull(),
}, (table) => [
  index("test_plan_selected_tests_test_plan_id_idx").on(table.testPlanId),
  index("test_plan_selected_tests_test_id_idx").on(table.testId),
  index("test_plan_selected_tests_api_test_id_idx").on(table.apiTestId),
  index("test_plan_selected_tests_organization_id_idx").on(table.organizationId),
]);

// Excel Sequences Map Table
export const excelSequencesMap = pgTable("excel_sequences_map", {
  id: serial("id").primaryKey(),
  testId: integer("test_id")
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  // Unique per organization, not globally: the id comes from a customer's own spreadsheet, so
  // two tenants using the same one is ordinary. See the unique constraint below.
  excelTestCaseId: text("excel_test_case_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("excel_sequences_map_test_id_idx").on(table.testId),
  index("excel_sequences_map_organization_id_idx").on(table.organizationId),
  unique("excel_sequences_map_org_excel_test_case_id_unique").on(table.organizationId, table.excelTestCaseId),
]);


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
export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  /** The username the invitation is for. Checked as still-unregistered at accept time too. */
  username: text("username").notNull(),
  /** The role the invitee gets on arrival. Never 'owner' — see the route. */
  role: text("role").notNull().default('editor'),
  /** Unguessable, and the only thing needed to accept. Unique so a lookup cannot be ambiguous. */
  token: text("token").notNull().unique(),
  invitedByUserId: integer("invited_by_user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  /** Set once used. A used invitation is kept for the audit trail rather than deleted. */
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("invitations_organization_id_idx").on(table.organizationId),
  // One live invitation per username per organization. Two organizations may both invite the
  // same username; whichever token is used first wins, and the other is then unacceptable
  // because the username exists.
  unique("invitations_org_username_unique").on(table.organizationId, table.username),
]);

export type Invitation = typeof invitations.$inferSelect;

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
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  /** Null once the actor's account is gone, or for an action taken before one existed. */
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: 'set null' }),
  /** Kept alongside actorUserId so the entry still names someone after the account is deleted. */
  actorUsername: text("actor_username"),
  /** Dotted verb, e.g. 'member.role_changed'. See AUDIT_ACTIONS. */
  action: text("action").notNull(),
  /** What the action was done to: 'user', 'invitation', 'organization'. */
  targetType: text("target_type"),
  /** Text rather than integer: targets are variously serial ids and uuids. */
  targetId: text("target_id"),
  /** Before/after values and anything else needed to understand the entry. Never secrets. */
  metadata: jsonb("metadata"),
  /** The API key the request authenticated with. Null for a session, or for the system itself. */
  apiKeyId: text("api_key_id"),
  /** The client address as the application saw it. */
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("audit_log_organization_id_idx").on(table.organizationId),
  index("audit_log_created_at_idx").on(table.createdAt),
  index("audit_log_organization_action_idx").on(table.organizationId, table.action),
]);

export type AuditLogEntry = typeof auditLog.$inferSelect;

/**
 * A named sequence of steps that many tests can call.
 *
 * A test's `sequence` is flat, so a login written once is written once per test: forty tests
 * that log in hold forty copies of the same six steps, and a change to the login flow is
 * thirty-nine edits and one test that fails next week for a reason nobody connects to it.
 *
 * Referenced rather than copied. A test holds one step naming the group and the runner expands
 * it at execution time, which is the point: editing the group changes what every test does on
 * its next run.
 */
export const stepGroups = pgTable("step_groups", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  userId: integer("user_id").notNull().references(() => users.id),
  /** Nullable like `tests.projectId`: a group may be one application's or the whole tenant's. */
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  description: text("description"),
  /** The same shape as a test's sequence, minus any call to another group — see step-groups.ts. */
  sequence: jsonb("sequence").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("step_groups_organization_id_idx").on(table.organizationId),
  index("step_groups_project_id_idx").on(table.projectId),
]);

export type StepGroup = typeof stepGroups.$inferSelect;
export type InsertStepGroup = typeof stepGroups.$inferInsert;

/**
 * The elements of an application, in one place instead of inside each test.
 *
 * `detected_elements` belongs to a single test, so the same button is written down once per
 * test that touches it. When the application moves that button every copy is wrong separately,
 * and the healing pass repairs the copy in whichever test ran — leaving the others to fail one
 * at a time, each looking like a new problem.
 *
 * Scoped to a project because a selector is a fact about one application.
 */
export const projectElements = pgTable("project_elements", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** How a person finds it. Unique within the project — see the migration. */
  name: text("name").notNull(),
  selector: text("selector").notNull(),
  /** What it was before healing ever moved it, so "what did this used to be?" has an answer. */
  originalSelector: text("original_selector"),
  /** The iframe chain, ' >> ' separated and outermost first. */
  frameSelector: text("frame_selector"),
  tag: text("tag"),
  elementType: text("element_type"),
  text: text("text"),
  attributes: jsonb("attributes"),
  /** Set when the healing pass repaired it: what the application has been moving underneath. */
  healedAt: timestamp("healed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("project_elements_organization_id_idx").on(table.organizationId),
  index("project_elements_project_id_idx").on(table.projectId),
  unique("project_elements_project_name_unique").on(table.projectId, table.name),
]);

export type ProjectElement = typeof projectElements.$inferSelect;
export type InsertProjectElement = typeof projectElements.$inferInsert;

/**
 * A word an organization uses for a group of tests.
 *
 * A test could be filed under a project and nothing else, so "the smoke tests" and "everything
 * that touches checkout" lived in people's heads and in the names they typed — and a plan was
 * assembled by hand, one test at a time, and stayed assembled.
 *
 * The name is unique per organization and compared without case; the index that enforces that
 * is on `lower(name)`, so it lives in the migration rather than here. "Smoke" and "smoke" are
 * one tag two people typed differently, and two tags that look identical in a list are worse
 * than none: a filter on one quietly omits the tests filed under the other.
 */
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("tags_organization_id_idx").on(table.organizationId),
]);

export type Tag = typeof tags.$inferSelect;
export type InsertTag = typeof tags.$inferInsert;

/**
 * Which tests carry which tag.
 *
 * Shaped like testPlanSelectedTests, and for the same reason: a plan may hold UI tests and API
 * tests, so a tag that could only go on one of the two would describe half a suite. Exactly one
 * of the two ids is set, which a CHECK constraint enforces rather than leaving it to whoever
 * writes the next insert.
 */
export const testTags = pgTable("test_tags", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: 'cascade' }),
  testId: integer("test_id").references(() => tests.id, { onDelete: 'cascade' }),
  apiTestId: integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' }),
  testType: text("test_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("test_tags_organization_id_idx").on(table.organizationId),
  index("test_tags_tag_id_idx").on(table.tagId),
  index("test_tags_test_id_idx").on(table.testId),
  index("test_tags_api_test_id_idx").on(table.apiTestId),
]);

export type TestTag = typeof testTags.$inferSelect;
export type InsertTestTag = typeof testTags.$inferInsert;

/** Which kinds of test a tag can be put on. */
export const TAGGABLE_TYPES = ['ui', 'api'] as const;
export type TaggableType = (typeof TAGGABLE_TYPES)[number];

/**
 * What a test used to be.
 *
 * Saving overwrote the test and that was the whole history: re-record a flow, save over the old
 * one, and yesterday's version was gone — which matters most exactly when it hurts most, with a
 * test that passed last week and fails today and nothing to say whether the application changed
 * or the test did.
 *
 * A row is written on every save, including the first, so version 1 is the test as created and
 * the newest row always matches the live test. Restoring writes the old content back as a NEW
 * version instead of deleting the ones after it, and app_user is granted SELECT and INSERT only
 * (see the migration): a history the application can rewrite is not evidence of anything.
 */
export const testVersions = pgTable("test_versions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  testId: integer("test_id").notNull().references(() => tests.id, { onDelete: 'cascade' }),
  /** 1-based and per test, so "version 4" names one row. */
  version: integer("version").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sequence: jsonb("sequence").notNull(),
  elements: jsonb("elements").notNull(),
  preconditions: jsonb("preconditions"),
  dataset: jsonb("dataset"),
  /** What changed since the version before, worked out when the row is written. */
  summary: text("summary"),
  /** Set when this version exists because somebody restored an older one. */
  restoredFromVersion: integer("restored_from_version"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("test_versions_organization_id_idx").on(table.organizationId),
  index("test_versions_test_id_idx").on(table.testId),
  unique("test_versions_test_version_unique").on(table.testId, table.version),
]);

export type TestVersion = typeof testVersions.$inferSelect;
export type InsertTestVersion = typeof testVersions.$inferInsert;

export const TEST_PUBLICATION_KINDS = ['publish', 'review', 'rollback', 'unpublish'] as const;
export type TestPublicationKind = (typeof TEST_PUBLICATION_KINDS)[number];

/** Every time a version of a test was put live, or taken down. Append-only. */
export const testPublications = pgTable("test_publications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  testId: integer("test_id").notNull().references(() => tests.id, { onDelete: 'cascade' }),
  /** Null for an 'unpublish': plans went back to the working copy. */
  version: integer("version"),
  kind: text("kind").$type<TestPublicationKind>().notNull(),
  reviewId: integer("review_id"),
  publishedBy: integer("published_by").references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
}, (table) => [
  index("test_publications_test_id_idx").on(table.testId),
  index("test_publications_organization_id_idx").on(table.organizationId),
]);

export const TEST_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type TestReviewStatus = (typeof TEST_REVIEW_STATUSES)[number];

/** A request to publish one version of a test, and what became of it. */
export const testReviews = pgTable("test_reviews", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  testId: integer("test_id").notNull().references(() => tests.id, { onDelete: 'cascade' }),
  version: integer("version").notNull(),
  status: text("status").$type<TestReviewStatus>().notNull().default('pending'),
  note: text("note"),
  requestedBy: integer("requested_by").references(() => users.id, { onDelete: 'set null' }),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp("decided_at"),
  decisionComment: text("decision_comment"),
}, (table) => [
  index("test_reviews_organization_status_idx").on(table.organizationId, table.status),
  index("test_reviews_test_id_idx").on(table.testId),
]);

export type TestReview = typeof testReviews.$inferSelect;

export const TEST_SUITE_KINDS = ['static', 'dynamic'] as const;
export type TestSuiteKind = (typeof TEST_SUITE_KINDS)[number];

/**
 * A named set of tests that plans share: chosen one by one (static), or every test carrying some
 * tags (dynamic, worked out when a run is created). See migrations/0034.
 */
export const testSuites = pgTable("test_suites", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind").$type<TestSuiteKind>().notNull().default('static'),
  /** The dynamic rule: tags a test must all carry. */
  tagIds: jsonb("tag_ids").$type<string[]>().notNull().default([]),
  createdBy: integer("created_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("test_suites_organization_id_idx").on(table.organizationId),
]);

export type TestSuite = typeof testSuites.$inferSelect;

/** The tests of a static suite, in order. */
export const testSuiteItems = pgTable("test_suite_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  suiteId: integer("suite_id").notNull().references(() => testSuites.id, { onDelete: 'cascade' }),
  testType: text("test_type").$type<'ui' | 'api'>().notNull(),
  testId: integer("test_id").references(() => tests.id, { onDelete: 'cascade' }),
  apiTestId: integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' }),
  position: integer("position").notNull(),
}, (table) => [
  index("test_suite_items_suite_id_idx").on(table.suiteId),
]);

/** The suites a plan includes, in order, after its own tests. */
export const testPlanSuites = pgTable("test_plan_suites", {
  testPlanId: text("test_plan_id").notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  suiteId: integer("suite_id").notNull().references(() => testSuites.id, { onDelete: 'cascade' }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  position: integer("position").notNull(),
}, (table) => [
  primaryKey({ columns: [table.testPlanId, table.suiteId] }),
  index("test_plan_suites_suite_id_idx").on(table.suiteId),
]);

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
export const issueTrackers = pgTable("issue_trackers", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  /** The Jira project key (SHOP), or the Azure DevOps project name. */
  projectKey: text("project_key").notNull(),
  issueType: text("issue_type").default('Bug').notNull(),
  /** Jira authenticates an API token against an account's email; Azure DevOps ignores it. */
  userEmail: text("user_email"),
  encryptedToken: text("encrypted_token").notNull(),
  tokenIv: text("token_iv").notNull(),
  tokenAuthTag: text("token_auth_tag").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("issue_trackers_organization_id_idx").on(table.organizationId),
]);

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
export const issueLinks = pgTable("issue_links", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  trackerId: text("tracker_id").notNull().references(() => issueTrackers.id, { onDelete: 'cascade' }),
  dedupeKey: text("dedupe_key").notNull(),
  testPlanId: text("test_plan_id").references(() => testPlans.id, { onDelete: 'set null' }),
  uiTestId: integer("ui_test_id").references(() => tests.id, { onDelete: 'set null' }),
  /** Kept as text too: the name is what the issue says, and it must stay readable. */
  testName: text("test_name").notNull(),
  browser: text("browser"),
  issueKey: text("issue_key").notNull(),
  issueUrl: text("issue_url").notNull(),
  firstExecutionId: text("first_execution_id").references(() => testPlanExecutions.id, { onDelete: 'set null' }),
  lastExecutionId: text("last_execution_id").references(() => testPlanExecutions.id, { onDelete: 'set null' }),
  occurrences: integer("occurrences").default(1).notNull(),
  /**
   * Set when the test passed again. Local knowledge only: whether the issue is closed is the
   * tracker's business, and claiming to know it would be claiming more than this can see.
   */
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("issue_links_organization_id_idx").on(table.organizationId),
  index("issue_links_tracker_id_idx").on(table.trackerId),
  index("issue_links_test_plan_id_idx").on(table.testPlanId),
  index("issue_links_last_execution_id_idx").on(table.lastExecutionId),
  unique("issue_links_tracker_dedupe_unique").on(table.trackerId, table.dedupeKey),
]);

export type IssueLink = typeof issueLinks.$inferSelect;
export type InsertIssueLink = typeof issueLinks.$inferInsert;

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
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  /** The key acts as this user. Deleting the member takes their keys with them. */
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** What it is for, in the words of whoever created it: "GitHub Actions", "nightly". */
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hashedKey: text("hashed_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** Answers "is this key still in use?", which is what makes cleaning them up possible. */
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  /** Set instead of deleting, so a key that ran ten thousand builds stays nameable. */
  revokedAt: timestamp("revoked_at"),
  /**
   * What the key may do, through /api/v1 only (see shared/api-scopes.ts). Null is a key from
   * before scopes: it acts as its user, with their role, on every endpoint, as it always did.
   */
  scopes: text("scopes").array(),
}, (table) => [
  index("api_keys_organization_id_idx").on(table.organizationId),
  index("api_keys_user_id_idx").on(table.userId),
]);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

/**
 * The actions worth recording, as a closed set: a free-text action column drifts into
 * near-duplicates ('member.removed' and 'member.remove') that nobody can query reliably.
 */
export const AUDIT_ACTIONS = {
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
  API_TEST_CREATED: 'api_test.created',
  API_TEST_UPDATED: 'api_test.updated',
  API_TEST_DELETED: 'api_test.deleted',
  PLAN_CREATED: 'plan.created',
  PLAN_UPDATED: 'plan.updated',
  PLAN_DELETED: 'plan.deleted',
  SCHEDULE_CREATED: 'schedule.created',
  SCHEDULE_UPDATED: 'schedule.updated',
  SCHEDULE_DELETED: 'schedule.deleted',
  PROJECT_CREATED: 'project.created',
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
  RUN_CANCELLED: 'run.cancelled',
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
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => [
  index("sessions_expire_idx").on(table.expire),
]);

// Relation Definitions
export const usersRelations = relations(users, ({ many, one }) => ({
  userSettings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  projects: many(projects),
  tests: many(tests),
  apiTestHistory: many(apiTestHistory),
  apiTests: many(apiTests),
  environments: many(environments),
  secrets: many(secrets),
}));

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  user: one(users, { fields: [environments.userId], references: [users.id] }),
  secrets: many(secrets),
}));

export const secretsRelations = relations(secrets, ({ one }) => ({
  environment: one(environments, { fields: [secrets.environmentId], references: [environments.id] }),
  user: one(users, { fields: [secrets.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  tests: many(tests),
  apiTests: many(apiTests),
}));

export const testsRelations = relations(tests, ({ one, many }) => ({
  user: one(users, { fields: [tests.userId], references: [users.id] }),
  project: one(projects, {
    fields: [tests.projectId],
    references: [projects.id],
  }),
  runs: many(testRuns),
  detectedElements: many(detectedElements),
  // reportResults: many(reportTestCaseResults, { relationName: 'uiTestReportResults' }) // Optional: if direct link needed
}));

export const detectedElementsRelations = relations(detectedElements, ({ one }) => ({
  test: one(tests, { fields: [detectedElements.testId], references: [tests.id] }),
}));

export const testRunsRelations = relations(testRuns, ({ one }) => ({
  test: one(tests, { fields: [testRuns.testId], references: [tests.id] }),
}));

export const excelSequencesMapRelations = relations(excelSequencesMap, ({ one }) => ({
  test: one(tests, { fields: [excelSequencesMap.testId], references: [tests.id] }),
}));

export const apiTestHistoryRelations = relations(apiTestHistory, ({ one }) => ({
  user: one(users, { fields: [apiTestHistory.userId], references: [users.id] }),
}));

export const apiTestsRelations = relations(apiTests, ({ one }) => ({
  user: one(users, { fields: [apiTests.userId], references: [users.id] }),
  project: one(projects, {
    fields: [apiTests.projectId],
    references: [projects.id],
  }),
  // reportResults: many(reportTestCaseResults, { relationName: 'apiTestReportResults' }) // Optional: if direct link needed
}));

export const testPlansRelations = relations(testPlans, ({ many }) => ({
  selectedTests: many(testPlanSelectedTests, {
    relationName: "selectedTestsForPlan",
  }),
  schedules: many(testPlanSchedules),
  executions: many(testPlanExecutions),
}));

export const testPlanSchedulesRelations = relations(
  testPlanSchedules,
  ({ one, many }) => ({
    testPlan: one(testPlans, {
      fields: [testPlanSchedules.testPlanId],
      references: [testPlans.id],
    }),
    executions: many(testPlanExecutions),
  }),
);

export const testPlanExecutionsRelations = relations(
  testPlanExecutions,
  ({ one, many }) => ({
    testPlan: one(testPlans, {
      fields: [testPlanExecutions.testPlanId],
      references: [testPlans.id],
    }),
    schedule: one(testPlanSchedules, {
      fields: [testPlanExecutions.scheduleId],
      references: [testPlanSchedules.id],
    }),
    detailedResults: many(reportTestCaseResults),
  }),
);

export const reportTestCaseResultsRelations = relations(
  reportTestCaseResults,
  ({ one }) => ({
    testPlanExecution: one(testPlanExecutions, {
      fields: [reportTestCaseResults.testPlanExecutionId],
      references: [testPlanExecutions.id],
    }),
    uiTest: one(tests, {
      fields: [reportTestCaseResults.uiTestId],
      references: [tests.id],
    }),
    apiTest: one(apiTests, {
      fields: [reportTestCaseResults.apiTestId],
      references: [apiTests.id],
    }),
  }),
);

export const testPlanSelectedTestsRelations = relations(
  testPlanSelectedTests,
  ({ one }) => ({
    testPlan: one(testPlans, {
      fields: [testPlanSelectedTests.testPlanId],
      references: [testPlans.id],
      relationName: "selectedTestsForPlan",
    }),
    uiTest: one(tests, {
      fields: [testPlanSelectedTests.testId],
      references: [tests.id],
    }),
    apiTest: one(apiTests, {
      fields: [testPlanSelectedTests.apiTestId],
      references: [apiTests.id],
    }),
  }),
);

// Zod Schemas for Insertions
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// ---- ZOD SCHEMAS AND TYPES for excelSequencesMap ----
export const insertExcelSequencesMapSchema = createInsertSchema(excelSequencesMap, {
  excelTestCaseId: z.string().min(1, "Excel Test Case ID is required"),
}).omit({ id: true, createdAt: true });

export const selectExcelSequencesMapSchema = createSelectSchema(excelSequencesMap);

export type ExcelSequencesMap = typeof excelSequencesMap.$inferSelect;
export type InsertExcelSequencesMap = typeof excelSequencesMap.$inferInsert;

// A precondition is an ordered API setup call executed (through the app under test's
// own API) before the UI sequence, to bring the system into the required state.
// Its request shape mirrors an apiTests row; it may reference the saved apiTest it
// was composed from.
/**
 * How to find out whether a precondition's setup call is needed at all.
 *
 * A precondition states a starting point — "this order exists", "this function is on" —
 * and a POST that creates it is only one way to reach it. Run the same test twice, or run
 * it against a system someone has already configured, and the call is at best wasted and at
 * worst destructive: it 409s and blocks the test, or it creates a second copy of a thing
 * the test then cannot identify.
 *
 * With a check, the runner asks first and calls only on a difference. Without one, nothing
 * changes: the setup runs every time, as it always has.
 */
export const PreconditionCheckSchema = z.object({
  method: z.string().optional().nullable(),
  url: z.string(),
  queryParams: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        enabled: z.boolean().optional().default(true),
      }),
    )
    .optional()
    .nullable(),
  requestHeaders: z.record(z.string()).optional().nullable(),
  /** Response statuses that mean the state is already there. Defaults to 2xx. */
  expectStatus: z.array(z.number().int()).optional().nullable(),
  /** A dotted path into the JSON body, e.g. `functions.netContentMachine`. */
  jsonPath: z.string().optional().nullable(),
  /** What that path has to hold for the state to count as already reached. */
  equals: z.union([z.string(), z.number(), z.boolean()]).optional().nullable(),
  /** Or, for an API that answers in prose: a substring the body has to contain. */
  bodyContains: z.string().optional().nullable(),
});
export type PreconditionCheck = z.infer<typeof PreconditionCheckSchema>;

export const PreconditionSchema = z.object({
  id: z.string(),
  name: z.string(),
  method: z.string(),
  url: z.string(), // may contain the {{baseUrl}} variable
  queryParams: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        enabled: z.boolean().optional().default(true),
      }),
    )
    .optional()
    .nullable(),
  requestHeaders: z.record(z.string()).optional().nullable(),
  requestBody: z.any().optional().nullable(),
  sourceApiTestId: z.number().int().optional().nullable(),
  /** Asked before the setup call; when it holds, the call is skipped. */
  check: PreconditionCheckSchema.optional().nullable(),
  /**
   * Statuses from the setup call itself that mean it had already been done.
   *
   * The common case is 409 Conflict on a create. Treating that as a failure blocks a test
   * whose precondition is, in fact, satisfied — and the report then says the setup failed,
   * which sends whoever reads it looking for a problem in the wrong place.
   */
  satisfiedStatuses: z.array(z.number().int()).optional().nullable(),
});
export type Precondition = z.infer<typeof PreconditionSchema>;

export const insertTestSchema = createInsertSchema(tests, {
  module: z.string().optional().nullable(), // Zod handles .nullable() correctly for optional fields
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  preconditions: z.array(PreconditionSchema).optional().nullable(),
  // Rows of input, each key a {{variable}} for that run. Typed rather than raw jsonb so a
  // malformed dataset is refused at save time instead of halfway through a scheduled run.
  dataset: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional().nullable(),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().nullable(),
  severity: z
    .enum(["Blocker", "Critical", "Major", "Minor"])
    .optional()
    .nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Which version runs is changed only by publishing (server/test-publishing.ts), which checks
  // the review policy and writes the history. Saving a test must not be a way round it.
  publishedVersion: true,
  // The tenancy boundary: never accepted from the client, always derived server-side
  // from the authenticated session (see the same treatment of organizationId elsewhere).
  organizationId: true,
  // Who owns the test, on the same terms and for the same reasons. This was missing while
  // organizationId was not, which broke saving outright: the column is NOT NULL, so the
  // schema demanded a userId in the body, the page rightly did not send one, and every
  // "Save test" answered 400 with `fieldErrors: { userId: ["Required"] }`. Accepting it
  // would have been the worse outcome — a client could then file a test under another
  // member of its organization. insertTestPlanSchema and insertApiTestSchema already omit
  // both; this one had drifted.
  userId: true,
});

export const insertProjectSchema = createInsertSchema(projects, {
  name: z.string().min(1, "Project name cannot be empty"),
}).pick({ name: true });

export const insertTestRunSchema = createInsertSchema(testRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

// Export Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTest = z.infer<typeof insertTestSchema>;
export type Test = typeof tests.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;
export type TestRun = typeof testRuns.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

export const insertDetectedElementSchema = createInsertSchema(detectedElements).omit({
  id: true,
  createdAt: true,
});

export type DetectedElement = typeof detectedElements.$inferSelect;
export type InsertDetectedElement = z.infer<typeof insertDetectedElementSchema>;

const TestMachineConfigSchema = z
  .object({
    os: z.string(),
    osVersion: z.string(),
    browserName: z.string(),
    browserVersion: z.string(),
    headless: z.boolean(),
  })
  .optional();

/**
 * When a run's video and trace are kept.
 *
 * 'on_failure' still records — Playwright writes a video when the context closes and cannot
 * be asked for one afterwards — and decides only whether the file survives the run.
 */
export const EVIDENCE_CAPTURE_MODES = ["never", "on_failure", "always"] as const;
export type EvidenceCaptureMode = (typeof EVIDENCE_CAPTURE_MODES)[number];

export const insertTestPlanSchema = createInsertSchema(testPlans, {
  name: z.string().min(1, "Test Plan Name is required"),
  description: z.string().optional(),
  testMachinesConfig: z.array(TestMachineConfigSchema).optional().nullable(),
  captureScreenshots: z
    .enum(["always", "on_failed_steps", "never"])
    .default("on_failed_steps"),
  // Kept in their own vocabulary rather than reusing the screenshots one: a video is of the
  // run, not of a step, so "on failed steps" would be a promise neither can keep.
  captureVideo: z.enum(EVIDENCE_CAPTURE_MODES).default("never"),
  captureTrace: z.enum(EVIDENCE_CAPTURE_MODES).default("never"),
  visualTestingEnabled: z.boolean().default(false),
  // Milliseconds. A second at least: the wizard once sent seconds here, and a value that small
  // is that mistake, not a timeout anybody wants.
  pageLoadTimeout: z.number().int().min(1000).max(600000).default(30000),
  elementTimeout: z.number().int().min(1000).max(600000).default(30000),
  onMajorStepFailure: z
    .enum(["abort_and_run_next_test_case", "stop_execution", "retry_step"])
    .default("abort_and_run_next_test_case"),
  onAbortedTestCase: z
    .enum(["delete_cookies_and_reuse_session", "stop_execution"])
    .default("delete_cookies_and_reuse_session"),
  onTestSuitePreRequisiteFailure: z
    .enum(["stop_execution", "skip_test_suite", "continue_anyway"])
    .default("stop_execution"),
  onTestCasePreRequisiteFailure: z
    .enum(["stop_execution", "skip_test_case", "continue_anyway"])
    .default("stop_execution"),
  onTestStepPreRequisiteFailure: z
    .enum(["abort_and_run_next_test_case", "stop_execution", "skip_test_step"])
    .default("abort_and_run_next_test_case"),
  reRunOnFailure: z.enum(["none", "once", "twice", "thrice"]).default("none"),
  // Capped rather than open: each unit is a real browser, and a number typed into a form is
  // not a statement about how much memory the runner has.
  maxParallelTests: z.number().int().min(1).max(16).default(1),
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
  selectedTests: z.array(z.object({
    id: z.number().int(), // This will be either tests.id or apiTests.id
    type: z.enum(['ui', 'api'])
  })).optional().default([])
});

export const updateTestPlanApiPayloadSchema = updateTestPlanSchema.extend({
  selectedTests: z.array(z.object({
    id: z.number().int(),
    type: z.enum(['ui', 'api'])
  })).optional() // On update, if not provided, selected tests are not changed. If an empty array is provided, all are removed.
});

export type TestPlan = typeof testPlans.$inferSelect;
export type InsertTestPlan = typeof testPlans.$inferInsert;
export type TestPlanSelectedTest = typeof testPlanSelectedTests.$inferSelect;
export type InsertTestPlanSelectedTest =
  typeof testPlanSelectedTests.$inferInsert;

export const insertTestPlanScheduleSchema = createInsertSchema(
  testPlanSchedules,
  {
    nextRunAt: z.number().positive().or(z.date()),
    browsers: z.array(z.string()).optional().nullable(),
    notificationConfigOverride: z.record(z.any()).optional().nullable(),
    executionParameters: z.record(z.any()).optional().nullable(),
    isActive: z.boolean().default(true),
    retryOnFailure: z.enum(["none", "once", "twice"]).default("none"),
  },
).omit({
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

export const selectTestPlanScheduleSchema =
  createSelectSchema(testPlanSchedules);
export const updateTestPlanScheduleSchema = insertTestPlanScheduleSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });

export type TestPlanSchedule = typeof testPlanSchedules.$inferSelect;
export type InsertTestPlanSchedule = typeof testPlanSchedules.$inferInsert;

export const insertTestPlanExecutionSchema = createInsertSchema(
  testPlanExecutions,
  {
    results: z.any().optional().nullable(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional().nullable(),
    browsers: z.array(z.string()).optional().nullable(),
    totalTests: z.number().int().optional().nullable(),
    passedTests: z.number().int().optional().nullable(),
    failedTests: z.number().int().optional().nullable(),
    skippedTests: z.number().int().optional().nullable(),
    executionDurationMs: z.number().int().optional().nullable(),
  },
).omit({ id: true });

export const selectTestPlanExecutionSchema =
  createSelectSchema(testPlanExecutions);

export type TestPlanExecution = typeof testPlanExecutions.$inferSelect;
export type InsertTestPlanExecution = typeof testPlanExecutions.$inferInsert;

// ---- ZOD SCHEMAS AND TYPES for reportTestCaseResults ----
export const insertReportTestCaseResultSchema = createInsertSchema(
  reportTestCaseResults,
  {
    startedAt: z.number(),
    completedAt: z.number().optional().nullable(),
    durationMs: z.number().int().optional().nullable(),
    status: z.enum(["Passed", "Failed", "Skipped", "Pending", "Error"]),
    priority: z
      .enum(["Critical", "High", "Medium", "Low"])
      .optional()
      .nullable(),
    severity: z
      .enum(["Blocker", "Critical", "Major", "Minor"])
      .optional()
      .nullable(),
    module: z.string().optional().nullable(),
    featureArea: z.string().optional().nullable(),
    scenario: z.string().optional().nullable(),
    component: z.string().optional().nullable(),
  },
).omit({ id: true });

export const selectReportTestCaseResultSchema = createSelectSchema(
  reportTestCaseResults,
);

export type ReportTestCaseResult = typeof reportTestCaseResults.$inferSelect;
export type InsertReportTestCaseResult = typeof reportTestCaseResults.$inferInsert;

export type ExecutionLog = typeof executionLogs.$inferSelect;
export type InsertExecutionLog = typeof executionLogs.$inferInsert;

export type Environment = typeof environments.$inferSelect;
export type InsertEnvironment = typeof environments.$inferInsert;
export type Secret = typeof secrets.$inferSelect;
export type InsertSecret = typeof secrets.$inferInsert;
export type TestPlanWebhook = typeof testPlanWebhooks.$inferSelect;
export type InsertTestPlanWebhook = typeof testPlanWebhooks.$inferInsert;


// --- Assertion Schemas ---
export const AssertionSourceSchema = z.enum([
  "status_code",
  "header",
  "body_json_path",
  "body_text",
  "response_time",
]);
export const AssertionComparisonSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "exists",
  "not_exists",
  "is_empty",
  "is_not_empty",
  "greater_than",
  "less_than",
  "greater_than_or_equals",
  "less_than_or_equals",
  "matches_regex",
  "not_matches_regex",
]);

export const AssertionSchema = z.object({
  id: z
    .string()
    .uuid()
    .describe("Client-generated unique ID for the assertion row"),
  source: AssertionSourceSchema,
  property: z
    .string()
    .optional()
    .describe(
      "e.g., Header name, JSONPath expression, or empty for status_code/body_text",
    ),
  comparison: AssertionComparisonSchema,
  targetValue: z
    .string()
    .optional()
    .describe("Expected value; regex for matches_regex"),
  enabled: z.boolean().default(true),
});
export type Assertion = z.infer<typeof AssertionSchema>;

// --- Extraction Schemas ---
//
// An assertion reads a response; an extraction takes a value out of one and binds it to a
// name, so the requests that follow in the same plan run can use it as `{{name}}`. Without
// it an API test can only check a single endpoint in isolation, and a real API test is a
// flow — authenticate, create, read back, delete.

/** Deliberately the assertion vocabulary: the same places, read for a different purpose. */
export const ExtractionSourceSchema = z.enum([
  "status_code",
  "header",
  "body_json_path",
  "body_text",
]);

export const ExtractionSchema = z.object({
  id: z.string().uuid().describe("Client-generated unique ID for the extraction row"),
  name: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Use letters, digits and underscores, starting with a letter or underscore",
    )
    .describe("The name the captured value is bound to, used as {{name}} later"),
  source: ExtractionSourceSchema,
  property: z
    .string()
    .optional()
    .describe("Header name or JSONPath; unused for status_code and body_text"),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// --- API Authentication Schemas ---
export const AuthTypeSchema = z.enum([
  "inherit",
  "none",
  "basic",
  "bearer",
  "jwtBearer",
  "digest",
  "oauth1",
  "oauth2",
  "hawk",
  "aws",
  "ntlm",
  "apiKey",
  "akamai",
  "asap",
]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const BasicAuthParamsSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type BasicAuthParams = z.infer<typeof BasicAuthParamsSchema>;
export const BearerTokenAuthParamsSchema = z.object({ token: z.string() });
export type BearerTokenAuthParams = z.infer<typeof BearerTokenAuthParamsSchema>;
export const ApiKeyAuthParamsSchema = z.object({
  key: z.string(),
  value: z.string(),
  addTo: z.enum(["header", "query"]),
});
export type ApiKeyAuthParams = z.infer<typeof ApiKeyAuthParamsSchema>;

/**
 * OAuth 2.0, in the two grants a test runner can complete on its own.
 *
 * Not the authorization-code grant: that one requires a human at a browser consenting to a
 * screen, which is not something a schedule at 3am can do. `client_credentials` is how a
 * service authenticates to an enterprise API, and `password` covers the older deployments
 * that still accept it — between them they reach most of what is worth testing.
 *
 * Every field defaults, so a saved test from before this existed — `{ type: 'oauth2' }`
 * with no params at all — still parses. The runner refuses at send time and says which
 * field is missing, which is a better place to find out than a schema error on load.
 */
export const OAuth2AuthParamsSchema = z.object({
  grantType: z.enum(["client_credentials", "password"]).default("client_credentials"),
  tokenUrl: z.string().default(""),
  clientId: z.string().default(""),
  clientSecret: z.string().default(""),
  scope: z.string().default(""),
  // `password` grant only.
  username: z.string().default(""),
  password: z.string().default(""),
  /**
   * Where the client credentials go. RFC 6749 §2.3.1 prefers the Basic header and requires
   * servers to support it; some accept them only in the body, so both are offered.
   */
  clientAuth: z.enum(["header", "body"]).default("header"),
});
export type OAuth2AuthParams = z.infer<typeof OAuth2AuthParamsSchema>;

export const AuthParamsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(AuthTypeSchema.enum.basic),
    params: BasicAuthParamsSchema,
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.bearer),
    params: BearerTokenAuthParamsSchema,
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.apiKey),
    params: ApiKeyAuthParamsSchema,
  }),
  z.object({ type: z.literal(AuthTypeSchema.enum.inherit) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.none) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.jwtBearer) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.digest) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.oauth1) }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.oauth2),
    params: OAuth2AuthParamsSchema.default({}),
  }),
  z.object({ type: z.literal(AuthTypeSchema.enum.hawk) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.aws) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.ntlm) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.akamai) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.asap) }),
]);
export type AuthParams = z.infer<typeof AuthParamsSchema>;

/**
 * The schemes the runner can actually satisfy.
 *
 * The enum above lists fourteen because the dropdown was built from a list of everything
 * Postman offers, and the other eight have never done anything: the request went out with
 * no credentials, the target answered 401, and the report blamed the endpoint. They stay in
 * the enum so a saved test that names one still loads and can be read and changed — but the
 * runner now refuses to send such a request, and the dropdown shows them as unavailable.
 *
 * Shared so those two cannot disagree about which is which; an architecture test pins the
 * runner's own handling against this list.
 */
export const IMPLEMENTED_AUTH_TYPES = [
  "none",
  "inherit",
  "basic",
  "bearer",
  "apiKey",
  "oauth2",
] as const satisfies readonly AuthType[];

export function isImplementedAuthType(type: AuthType): boolean {
  return (IMPLEMENTED_AUTH_TYPES as readonly AuthType[]).includes(type);
}

const bodyTypesArray = [
  "none",
  "form-data",
  "x-www-form-urlencoded",
  "raw",
  "binary",
  "GraphQL",
] as const;
export const BodyTypeSchema = z.enum(bodyTypesArray);
export type BodyType = z.infer<typeof BodyTypeSchema>;

export const KeyValuePairSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
});
export type KeyValuePair = z.infer<typeof KeyValuePairSchema>;

export const FormDataFieldMetadataSchema = z.union([
  z.object({
    id: z.string(),
    key: z.string(),
    enabled: z.boolean(),
    type: z.literal("text"),
    value: z.string(),
  }),
  z.object({
    id: z.string(),
    key: z.string(),
    enabled: z.boolean(),
    type: z.literal("file"),
    fileName: z.string(),
    fileType: z.string(),
  }),
]);
export type FormDataFieldMetadata = z.infer<typeof FormDataFieldMetadataSchema>;

export const insertApiTestHistorySchema = createInsertSchema(
  apiTestHistory,
  {},
).omit({
  id: true,
  createdAt: true,
  userId: true,
  // The tenancy boundary: never accepted from the client, always derived server-side
  // from the authenticated session.
  organizationId: true,
});
export type InsertApiTestHistoryPayload = z.infer<typeof insertApiTestHistorySchema>;

export const insertApiTestSchema = createInsertSchema(apiTests, {
  name: z.string().min(1, "Test name cannot be empty"),
  method: z.string().min(1, "HTTP method is required"),
  url: z.string().url("Invalid URL format"),
  module: z.string().optional().nullable(),
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().nullable(),
  severity: z
    .enum(["Blocker", "Critical", "Major", "Minor"])
    .optional()
    .nullable(),
  // Typed rather than left as raw jsonb: a malformed extraction is only discovered at run
  // time otherwise, in a worker, halfway through a scheduled plan.
  extractions: z.array(ExtractionSchema).optional().nullable(),
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    userId: true,
    // The tenancy boundary: never accepted from the client, always derived server-side
    // from the authenticated session.
    organizationId: true,
    projectId: true,
    queryParams: true,
    requestHeaders: true,
    requestBody: true,
    assertions: true,
    authParams: true,
    bodyFormData: true,
    bodyUrlEncoded: true,
  })
  .extend({
    queryParams: z
      .record(z.string().or(z.array(z.string())))
      .optional()
      .nullable(),
    requestHeaders: z.record(z.string()).optional().nullable(),
    requestBody: z.any().optional().nullable(),
    assertions: z.array(AssertionSchema).optional().nullable(),
    authType: AuthTypeSchema.optional().nullable(),
    authParams: AuthParamsSchema.optional().nullable(),
    bodyType: BodyTypeSchema.optional().nullable(),
    bodyRawContentType: z.string().optional().nullable(),
    bodyFormData: z.array(FormDataFieldMetadataSchema).optional().nullable(),
    bodyUrlEncoded: z.array(KeyValuePairSchema).optional().nullable(),
    bodyGraphqlQuery: z.string().optional().nullable(),
    bodyGraphqlVariables: z.string().optional().nullable(),
  });

export const updateApiTestSchema = insertApiTestSchema.partial().extend({
  queryParams: z
    .record(z.string().or(z.array(z.string())))
    .optional()
    .nullable(),
  requestHeaders: z.record(z.string()).optional().nullable(),
  requestBody: z.any().optional().nullable(),
  assertions: z.array(AssertionSchema).optional().nullable(),
  authType: AuthTypeSchema.optional().nullable(),
  authParams: AuthParamsSchema.optional().nullable(),
  bodyType: BodyTypeSchema.optional().nullable(),
  bodyRawContentType: z.string().optional().nullable(),
  bodyFormData: z.array(FormDataFieldMetadataSchema).optional().nullable(),
  bodyUrlEncoded: z.array(KeyValuePairSchema).optional().nullable(),
  bodyGraphqlQuery: z.string().optional().nullable(),
  bodyGraphqlVariables: z.string().optional().nullable(),
});

export type ApiTestHistoryEntry = typeof apiTestHistory.$inferSelect;
export type InsertApiTestHistoryEntry = typeof apiTestHistory.$inferInsert;
export type ApiTest = typeof apiTests.$inferSelect;
export type InsertApiTest = typeof apiTests.$inferInsert;

export const AdhocTestActionSchema = z.object({
  // Keep in sync with ADHOC_ACTION_IDS in shared/recording.ts, which drives the
  // recorder → builder mapping.
  //
  // Plus the one step that is not an action on a page: a call to a step group. It is accepted
  // here because a test may hold one, and it is deliberately not in ADHOC_ACTION_IDS because
  // the step executor's exhaustive table is what guarantees every *action* has an
  // implementation — and this one is replaced by the group's own steps before the executor
  // runs. See server/step-groups.ts.
  id: z.union([z.enum(ADHOC_ACTION_IDS), z.literal(STEP_GROUP_ACTION_ID)]),
  type: z.string(),
  name: z.string(),
  icon: z.string(),
  description: z.string(),
});
export type AdhocTestAction = z.infer<typeof AdhocTestActionSchema>;

export const AdhocDetectedElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  selector: z.string(),
  // The iframe chain the selector is relative to, ' >> ' separated. Absent for the top
  // document, which is every element that existed before frames were supported.
  frameSelector: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  tag: z.string(),
  attributes: z.record(z.string()),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});
export type AdhocDetectedElement = z.infer<typeof AdhocDetectedElementSchema>;

/** The requirements of an action, or none for the one step that is not an action. */
function requirementsFor(id: string) {
  return (ACTION_REQUIREMENTS as Record<string, { target: boolean; value: boolean; valueRequired: boolean } | undefined>)[id];
}

export const AdhocTestStepSchema = z
  .object({
    id: z.string(),
    action: AdhocTestActionSchema,
    targetElement: AdhocDetectedElementSchema.optional(),
    value: z.string().optional().nullable(),
  })
  // Both rules read the same table the builder draws its fields from. They used to carry
  // their own copies of the lists, which is how a step could be accepted here with nothing
  // for the runner to act on: the conditional waits were added to the action list and none
  // of the three copies was updated, so `waitForElement` validated without a selector and
  // then failed at run time with a message about a missing target.
  // A call to a step group has no requirements of its own: what it needs is whatever the
  // group’s own steps need, and those were validated when the group was saved.
  .refine((data) => !requirementsFor(data.action.id)?.target || !!data.targetElement, {
    message: "This action needs an element to act on.",
    path: ["targetElement"],
  })
  .refine(
    (data) =>
      !requirementsFor(data.action.id)?.valueRequired ||
      (typeof data.value === "string" && data.value.trim() !== ""),
    {
      message: "This action needs a non-empty value.",
      path: ["value"],
    },
  )
  .refine(
    (data) => {
      if (data.action.id === "wait") return !isNaN(Number(data.value));
      return true;
    },
    {
      message:
        "For 'wait' action, value must be a number (e.g., '1000' for 1 second)",
      path: ["value"],
    },
  )
  .refine(
    (data) => {
      // A recorded navigation replays as page.goto(value), so the value must be a URL.
      if (data.action.id !== "navigate") return true;
      try {
        new URL(data.value ?? "");
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "For 'navigate' action, value must be an absolute URL",
      path: ["value"],
    },
  );
export type AdhocTestStep = z.infer<typeof AdhocTestStepSchema>;

export const insertSystemSettingSchema = createInsertSchema(systemSettings);
export const selectSystemSettingSchema = createSelectSchema(systemSettings);

/**
 * Tables whose rows belong to exactly one organization and are therefore protected by an
 * RLS policy. Exported so tests can enumerate them from the schema rather than from a
 * hand-maintained list, which would be forgotten the first time a table is added.
 */
export const ORG_SCOPED_TABLES = [
  'projects', 'tests', 'test_runs', 'detected_elements', 'api_tests', 'api_test_history',
  'test_plans', 'test_plan_schedules', 'test_plan_executions', 'test_plan_selected_tests',
  'test_plan_webhooks', 'report_test_case_results', 'execution_logs', 'environments',
  'secrets', 'excel_sequences_map',
  // audit_log is org-scoped like the rest, but its grants are narrower: SELECT and INSERT
  // only, so the application cannot rewrite history. See migration 0009.
  'audit_log',
  // Shared building blocks rather than per-test copies: a sequence many tests call, and the
  // elements of one application. Org-scoped and policed like everything else.
  'step_groups', 'project_elements',
  // What a test is for, and what it used to be. test_versions is granted SELECT and INSERT
  // only — the application cannot rewrite its own history. See migration 0018.
  'tags', 'test_tags', 'test_versions',
  // Where a failure is filed, and which failure produced which issue.
  'issue_trackers', 'issue_links',
  // api_keys is org-scoped and policed like the rest. Unlike `invitations`, which cannot be,
  // the one lookup that must happen before an organization is known — authenticating a
  // request that carries a key — is a privileged bootstrap read in middleware, the same shape
  // as passport's deserializeUser. Every other access is an ordinary request.
  'api_keys',
  // Who is on a restricted project. Org-scoped like the rest; what they see inside the
  // organization is narrowed further by the project policies of migration 0031.
  'project_members',
  // Which version of a test is live, and the reviews that put it there (migration 0032).
  // test_publications is SELECT and INSERT only: a publication history is evidence.
  'test_publications', 'test_reviews',
  // Suites, their tests, and the plans that include them (migration 0034).
  'test_suites', 'test_suite_items', 'test_plan_suites',
] as const;
