import { pgTable, text, integer, serial, timestamp, boolean, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations } from 'drizzle-orm';
import { ADHOC_ACTION_IDS } from './recording';

// Table Definitions
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // The tenancy boundary. One user belongs to exactly one organization.
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  // Verbs, not rows: RLS decides which rows are visible, this decides what may be done to them.
  role: text("role").notNull().default('editor'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
}, (table) => [
  index("projects_user_id_idx").on(table.userId),
  index("projects_organization_id_idx").on(table.organizationId),
]);

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
  status: text("status").notNull().default("draft"),
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

// Test Plans Table
export const testPlans = pgTable("test_plans", {
  id: text('id').primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  testMachinesConfig: jsonb('test_machines_config'),
  captureScreenshots: text('capture_screenshots').default('on_failed_steps'),
  visualTestingEnabled: boolean('visual_testing_enabled').default(false),
  pageLoadTimeout: integer('page_load_timeout').default(30000),
  elementTimeout: integer('element_timeout').default(30000),
  onMajorStepFailure: text('on_major_step_failure').default('abort_and_run_next_test_case'),
  onAbortedTestCase: text('on_aborted_test_case').default('delete_cookies_and_reuse_session'),
  onTestSuitePreRequisiteFailure: text('on_test_suite_pre_requisite_failure').default('stop_execution'),
  onTestCasePreRequisiteFailure: text('on_test_case_pre_requisite_failure').default('stop_execution'),
  onTestStepPreRequisiteFailure: text('on_test_step_pre_requisite_failure').default('abort_and_run_next_test_case'),
  reRunOnFailure: text('re_run_on_failure').default('none'),
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

export const testPlanExecutions = pgTable("test_plan_executions", {
  id: text('id').primaryKey(),
  scheduleId: text('schedule_id').references(() => testPlanSchedules.id, { onDelete: 'set null' }),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  status: text('status').notNull().default('pending'),
  results: jsonb("results"),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
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
  status: text("status").notNull(),
  reasonForFailure: text("reason_for_failure"),
  screenshotUrl: text("screenshot_url"),
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
  token: text('token').notNull().unique(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("audit_log_organization_id_idx").on(table.organizationId),
  index("audit_log_created_at_idx").on(table.createdAt),
]);

export type AuditLogEntry = typeof auditLog.$inferSelect;

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
});
export type Precondition = z.infer<typeof PreconditionSchema>;

export const insertTestSchema = createInsertSchema(tests, {
  module: z.string().optional().nullable(), // Zod handles .nullable() correctly for optional fields
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  preconditions: z.array(PreconditionSchema).optional().nullable(),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().nullable(),
  severity: z
    .enum(["Blocker", "Critical", "Major", "Minor"])
    .optional()
    .nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // The tenancy boundary: never accepted from the client, always derived server-side
  // from the authenticated session (see the same treatment of organizationId elsewhere).
  organizationId: true,
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

export const insertTestPlanSchema = createInsertSchema(testPlans, {
  name: z.string().min(1, "Test Plan Name is required"),
  description: z.string().optional(),
  testMachinesConfig: z.array(TestMachineConfigSchema).optional().nullable(),
  captureScreenshots: z
    .enum(["always", "on_failed_steps", "never"])
    .default("on_failed_steps"),
  visualTestingEnabled: z.boolean().default(false),
  pageLoadTimeout: z.number().int().positive().default(30000),
  elementTimeout: z.number().int().positive().default(30000),
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
  notificationSettings: z
    .object({
      passed: z.boolean().default(true),
      failed: z.boolean().default(true),
      notExecuted: z.boolean().default(true),
      stopped: z.boolean().default(true),
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
  z.object({ type: z.literal(AuthTypeSchema.enum.oauth2) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.hawk) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.aws) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.ntlm) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.akamai) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.asap) }),
]);
export type AuthParams = z.infer<typeof AuthParamsSchema>;

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
  id: z.enum(ADHOC_ACTION_IDS),
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

export const AdhocTestStepSchema = z
  .object({
    id: z.string(),
    action: AdhocTestActionSchema,
    targetElement: AdhocDetectedElementSchema.optional(),
    value: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      if (
        [
          "click",
          "input",
          "hover",
          "select",
          "assert",
          "assertTextContains",
          "assertElementCount",
        ].includes(data.action.id) &&
        !data.targetElement
      )
        return false;
      return true;
    },
    {
      message:
        "targetElement is required for actions like click, input, hover, select, assert, assertTextContains, assertElementCount",
      path: ["targetElement"],
    },
  )
  .refine(
    (data) => {
      if (
        [
          "input",
          "wait",
          "select",
          "navigate",
          "assertTextContains",
          "assertElementCount",
        ].includes(data.action.id) &&
        (data.value === undefined ||
          data.value === null ||
          data.value.trim() === "")
      )
        return false;
      return true;
    },
    {
      message:
        "A non-empty value is required for input, wait, select, navigate, assertTextContains, and assertElementCount actions",
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
] as const;
