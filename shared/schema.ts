import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations, sql } from 'drizzle-orm';

// Table Definitions
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export const userSettings = sqliteTable("user_settings", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  theme: text("theme").default('light').notNull(),
  defaultTestUrl: text("default_test_url"),
  playwrightBrowser: text("playwright_browser").default('chromium').notNull(),
  playwrightHeadless: integer("playwright_headless", { mode: 'boolean' }).default(true).notNull(),
  playwrightDefaultTimeout: integer("playwright_default_timeout").default(30000).notNull(),
  playwrightWaitTime: integer("playwright_wait_time").default(1000).notNull(),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export const tests = sqliteTable("tests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sequence: text("sequence", { mode: 'json' }).notNull(),
  elements: text("elements", { mode: 'json' }).notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),

  // NEW Fields for reporting - .nullable() removed, nullability is default if .notNull() is absent
  module: text("module"),
  featureArea: text("feature_area"),
  scenario: text("scenario"),
  component: text("component"),
  priority: text("priority", { enum: ['Critical', 'High', 'Medium', 'Low'] }).default('Medium'),
  severity: text("severity", { enum: ['Blocker', 'Critical', 'Major', 'Minor'] }).default('Major'),
});

export const testRuns = sqliteTable("test_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  testId: integer("test_id").notNull().references(() => tests.id),
  status: text("status").notNull(),
  results: text("results", { mode: 'json' }),
  startedAt: integer("started_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
  completedAt: integer("completed_at", { mode: 'timestamp' }),
});

export const apiTestHistory = sqliteTable("api_test_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  method: text("method").notNull(),
  url: text("url").notNull(),
  queryParams: text("query_params", { mode: 'json' }),
  requestHeaders: text("request_headers", { mode: 'json' }),
  requestBody: text("request_body"),
  responseStatus: integer("response_status"),
  responseHeaders: text("response_headers", { mode: 'json' }),
  responseBody: text("response_body"),
  durationMs: integer("duration_ms"),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export const apiTests = sqliteTable("api_tests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  method: text("method").notNull(),
  url: text("url").notNull(),
  queryParams: text("query_params", { mode: 'json' }),
  requestHeaders: text("request_headers", { mode: 'json' }),
  requestBody: text("request_body"),
  assertions: text("assertions", { mode: 'json' }),
  authType: text("auth_type"),
  authParams: text("auth_params", { mode: 'json' }),
  bodyType: text("body_type"),
  bodyRawContentType: text("body_raw_content_type"),
  bodyFormData: text("body_form_data", { mode: 'json' }),
  bodyUrlEncoded: text("body_url_encoded", { mode: 'json' }),
  bodyGraphqlQuery: text("body_graphql_query"),
  bodyGraphqlVariables: text("body_graphql_variables"),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),

  // NEW Fields for reporting - .nullable() removed
  module: text("module"),
  featureArea: text("feature_area"),
  scenario: text("scenario"),
  component: text("component"),
  priority: text("priority", { enum: ['Critical', 'High', 'Medium', 'Low'] }).default('Medium'),
  severity: text("severity", { enum: ['Blocker', 'Critical', 'Major', 'Minor'] }).default('Major'),
});

// System Settings Table
export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// Test Plans Table
export const testPlans = sqliteTable("test_plans", {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  testMachinesConfig: text('test_machines_config', { mode: 'json' }),
  captureScreenshots: text('capture_screenshots').default('on_failed_steps'),
  visualTestingEnabled: integer('visual_testing_enabled', { mode: 'boolean' }).default(false),
  pageLoadTimeout: integer('page_load_timeout').default(30000),
  elementTimeout: integer('element_timeout').default(30000),
  onMajorStepFailure: text('on_major_step_failure').default('abort_and_run_next_test_case'),
  onAbortedTestCase: text('on_aborted_test_case').default('delete_cookies_and_reuse_session'),
  onTestSuitePreRequisiteFailure: text('on_test_suite_pre_requisite_failure').default('stop_execution'),
  onTestCasePreRequisiteFailure: text('on_test_case_pre_requisite_failure').default('stop_execution'),
  onTestStepPreRequisiteFailure: text('on_test_step_pre_requisite_failure').default('abort_and_run_next_test_case'),
  reRunOnFailure: text('re_run_on_failure').default('none'),
  notificationSettings: text('notification_settings', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

// Test Plan Schedules Table
export const testPlanSchedules = sqliteTable("test_plan_schedules", {
  id: text('id').primaryKey(),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  scheduleName: text('schedule_name').notNull(),
  frequency: text('frequency').notNull(),
  nextRunAt: integer('next_run_at', { mode: 'timestamp' }).notNull(),
  environment: text('environment'),
  browsers: text('browsers', { mode: 'json' }),
  notificationConfigOverride: text('notification_config_override', { mode: 'json' }),
  executionParameters: text('execution_parameters', { mode: 'json' }),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  retryOnFailure: text('retry_on_failure', { enum: ['none', 'once', 'twice'] }).default('none').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// Test Plan Executions Table
export const testPlanExecutions = sqliteTable("test_plan_executions", {
  id: text('id').primaryKey(),
  scheduleId: text('schedule_id').references(() => testPlanSchedules.id, { onDelete: 'set null' }),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed', 'error', 'cancelled'] }).notNull().default('pending'),
  results: text("results", { mode: 'json' }),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  environment: text('environment'),
  browsers: text('browsers', { mode: 'json' }),
  triggeredBy: text('triggered_by', { enum: ['scheduled', 'manual', 'api'] }).notNull().default('manual'),
  totalTests: integer("total_tests"), // Nullable by default
  passedTests: integer("passed_tests"), // Nullable by default
  failedTests: integer("failed_tests"), // Nullable by default
  skippedTests: integer("skipped_tests"), // Nullable by default
  executionDurationMs: integer("execution_duration_ms"), // Nullable by default
});

// ---- NEW TABLE for Individual Test Case Results ----
export const reportTestCaseResults = sqliteTable("report_test_case_results", {
  id: text("id").primaryKey(),
  testPlanExecutionId: text("test_plan_execution_id").notNull().references(() => testPlanExecutions.id, { onDelete: 'cascade' }),
  uiTestId: integer("ui_test_id").references(() => tests.id, { onDelete: 'set null' }),
  apiTestId: integer("api_test_id").references(() => apiTests.id, { onDelete: 'set null' }),
  testType: text("test_type", { enum: ['ui', 'api'] }).notNull(),
  testName: text("test_name").notNull(),
  status: text("status", { enum: ['Passed', 'Failed', 'Skipped', 'Pending', 'Error'] }).notNull(),
  reasonForFailure: text("reason_for_failure"),
  screenshotUrl: text("screenshot_url"),
  detailedLog: text("detailed_log"),
  startedAt: integer("started_at", { mode: 'timestamp' }).notNull(),
  completedAt: integer("completed_at", { mode: 'timestamp' }),
  durationMs: integer("duration_ms"),
  module: text("module"),
  featureArea: text("feature_area"),
  scenario: text("scenario"),
  component: text("component"),
  priority: text("priority", { enum: ['Critical', 'High', 'Medium', 'Low'] }), // Default is not set here, can be set by app logic
  severity: text("severity", { enum: ['Blocker', 'Critical', 'Major', 'Minor'] }), // Default is not set here
});

// Test Plan Selected Tests Table
export const testPlanSelectedTests = sqliteTable("test_plan_selected_tests", {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testPlanId: text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' }),
  testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
  testType: text('test_type', { enum: ['ui', 'api'] }).notNull(),
});


// Relation Definitions
export const usersRelations = relations(users, ({ many, one }) => ({
  userSettings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  projects: many(projects),
  tests: many(tests),
  apiTestHistory: many(apiTestHistory),
  apiTests: many(apiTests),
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
  project: one(projects, { fields: [tests.projectId], references: [projects.id] }),
  runs: many(testRuns),
  // reportResults: many(reportTestCaseResults, { relationName: 'uiTestReportResults' }) // Optional: if direct link needed
}));

export const testRunsRelations = relations(testRuns, ({ one }) => ({
  test: one(tests, { fields: [testRuns.testId], references: [tests.id] }),
}));

export const apiTestHistoryRelations = relations(apiTestHistory, ({ one }) => ({
  user: one(users, { fields: [apiTestHistory.userId], references: [users.id] }),
}));

export const apiTestsRelations = relations(apiTests, ({ one, many }) => ({
  user: one(users, { fields: [apiTests.userId], references: [users.id] }),
  project: one(projects, { fields: [apiTests.projectId], references: [projects.id] }),
  // reportResults: many(reportTestCaseResults, { relationName: 'apiTestReportResults' }) // Optional: if direct link needed
}));

export const testPlansRelations = relations(testPlans, ({ many }) => ({
  selectedTests: many(testPlanSelectedTests, { relationName: 'selectedTestsForPlan' }),
  schedules: many(testPlanSchedules),
  executions: many(testPlanExecutions),
}));

export const testPlanSchedulesRelations = relations(testPlanSchedules, ({ one, many }) => ({
  testPlan: one(testPlans, { fields: [testPlanSchedules.testPlanId], references: [testPlans.id] }),
  executions: many(testPlanExecutions),
}));

export const testPlanExecutionsRelations = relations(testPlanExecutions, ({ one, many }) => ({
  testPlan: one(testPlans, { fields: [testPlanExecutions.testPlanId], references: [testPlans.id] }),
  schedule: one(testPlanSchedules, { fields: [testPlanExecutions.scheduleId], references: [testPlanSchedules.id] }),
  detailedResults: many(reportTestCaseResults),
}));

export const reportTestCaseResultsRelations = relations(reportTestCaseResults, ({ one }) => ({
  testPlanExecution: one(testPlanExecutions, { fields: [reportTestCaseResults.testPlanExecutionId], references: [testPlanExecutions.id] }),
  uiTest: one(tests, { fields: [reportTestCaseResults.uiTestId], references: [tests.id] }),
  apiTest: one(apiTests, { fields: [reportTestCaseResults.apiTestId], references: [apiTests.id] }),
}));

export const testPlanSelectedTestsRelations = relations(testPlanSelectedTests, ({ one }) => ({
  testPlan: one(testPlans, { fields: [testPlanSelectedTests.testPlanId], references: [testPlans.id], relationName: 'selectedTestsForPlan' }),
  uiTest: one(tests, { fields: [testPlanSelectedTests.testId], references: [tests.id] }),
  apiTest: one(apiTests, { fields: [testPlanSelectedTests.apiTestId], references: [apiTests.id] }),
}));


// Zod Schemas for Insertions
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTestSchema = createInsertSchema(tests, {
  module: z.string().optional().nullable(), // Zod handles .nullable() correctly for optional fields
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional().nullable(),
  severity: z.enum(['Blocker', 'Critical', 'Major', 'Minor']).optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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

const TestMachineConfigSchema = z.object({
  os: z.string(),
  osVersion: z.string(),
  browserName: z.string(),
  browserVersion: z.string(),
  headless: z.boolean(),
}).optional();

export const insertTestPlanSchema = createInsertSchema(testPlans, {
  name: z.string().min(1, "Test Plan Name is required"),
  description: z.string().optional(),
  testMachinesConfig: z.array(TestMachineConfigSchema).optional().nullable(),
  captureScreenshots: z.enum(['always', 'on_failed_steps', 'never']).default('on_failed_steps'),
  visualTestingEnabled: z.boolean().default(false),
  pageLoadTimeout: z.number().int().positive().default(30000),
  elementTimeout: z.number().int().positive().default(30000),
  onMajorStepFailure: z.enum(['abort_and_run_next_test_case', 'stop_execution', 'retry_step']).default('abort_and_run_next_test_case'),
  onAbortedTestCase: z.enum(['delete_cookies_and_reuse_session', 'stop_execution']).default('delete_cookies_and_reuse_session'),
  onTestSuitePreRequisiteFailure: z.enum(['stop_execution', 'skip_test_suite', 'continue_anyway']).default('stop_execution'),
  onTestCasePreRequisiteFailure: z.enum(['stop_execution', 'skip_test_case', 'continue_anyway']).default('stop_execution'),
  onTestStepPreRequisiteFailure: z.enum(['abort_and_run_next_test_case', 'stop_execution', 'skip_test_step']).default('abort_and_run_next_test_case'),
  reRunOnFailure: z.enum(['none', 'once', 'twice', 'thrice']).default('none'),
  notificationSettings: z.object({
    passed: z.boolean().default(true),
    failed: z.boolean().default(true),
    notExecuted: z.boolean().default(true),
    stopped: z.boolean().default(true),
  }).optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const selectTestPlanSchema = createSelectSchema(testPlans);
export const updateTestPlanSchema = insertTestPlanSchema.partial();

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
}).omit({ id: true, createdAt: true, updatedAt: true });

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


// --- Assertion Schemas ---
export const AssertionSourceSchema = z.enum(['status_code', 'header', 'body_json_path', 'body_text', 'response_time']);
export const AssertionComparisonSchema = z.enum([
  'equals', 'not_equals',
  'contains', 'not_contains',
  'exists', 'not_exists',
  'is_empty', 'is_not_empty',
  'greater_than', 'less_than',
  'greater_than_or_equals', 'less_than_or_equals',
  'matches_regex', 'not_matches_regex'
]);

export const AssertionSchema = z.object({
  id: z.string().uuid().describe("Client-generated unique ID for the assertion row"),
  source: AssertionSourceSchema,
  property: z.string().optional().describe("e.g., Header name, JSONPath expression, or empty for status_code/body_text"),
  comparison: AssertionComparisonSchema,
  targetValue: z.string().optional().describe("Expected value; regex for matches_regex"),
  enabled: z.boolean().default(true),
});
export type Assertion = z.infer<typeof AssertionSchema>;

// --- API Authentication Schemas ---
export const AuthTypeSchema = z.enum([
  'inherit', 'none', 'basic', 'bearer', 'jwtBearer', 'digest', 'oauth1', 'oauth2',
  'hawk', 'aws', 'ntlm', 'apiKey', 'akamai', 'asap',
]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const BasicAuthParamsSchema = z.object({ username: z.string(), password: z.string() });
export type BasicAuthParams = z.infer<typeof BasicAuthParamsSchema>;
export const BearerTokenAuthParamsSchema = z.object({ token: z.string() });
export type BearerTokenAuthParams = z.infer<typeof BearerTokenAuthParamsSchema>;
export const ApiKeyAuthParamsSchema = z.object({ key: z.string(), value: z.string(), addTo: z.enum(['header', 'query']) });
export type ApiKeyAuthParams = z.infer<typeof ApiKeyAuthParamsSchema>;

export const AuthParamsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(AuthTypeSchema.enum.basic), params: BasicAuthParamsSchema }),
  z.object({ type: z.literal(AuthTypeSchema.enum.bearer), params: BearerTokenAuthParamsSchema }),
  z.object({ type: z.literal(AuthTypeSchema.enum.apiKey), params: ApiKeyAuthParamsSchema }),
  z.object({ type: z.literal(AuthTypeSchema.enum.inherit) }), z.object({ type: z.literal(AuthTypeSchema.enum.none) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.jwtBearer) }), z.object({ type: z.literal(AuthTypeSchema.enum.digest) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.oauth1) }), z.object({ type: z.literal(AuthTypeSchema.enum.oauth2) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.hawk) }), z.object({ type: z.literal(AuthTypeSchema.enum.aws) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.ntlm) }), z.object({ type: z.literal(AuthTypeSchema.enum.akamai) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.asap) }),
]);
export type AuthParams = z.infer<typeof AuthParamsSchema>;

const bodyTypesArray = ['none', 'form-data', 'x-www-form-urlencoded', 'raw', 'binary', 'GraphQL'] as const;
export const BodyTypeSchema = z.enum(bodyTypesArray);
export type BodyType = z.infer<typeof BodyTypeSchema>;

export const KeyValuePairSchema = z.object({ id: z.string(), key: z.string(), value: z.string(), enabled: z.boolean() });
export type KeyValuePair = z.infer<typeof KeyValuePairSchema>;

export const FormDataFieldMetadataSchema = z.union([
  z.object({ id: z.string(), key: z.string(), enabled: z.boolean(), type: z.literal('text'), value: z.string() }),
  z.object({ id: z.string(), key: z.string(), enabled: z.boolean(), type: z.literal('file'), fileName: z.string(), fileType: z.string() }),
]);
export type FormDataFieldMetadata = z.infer<typeof FormDataFieldMetadataSchema>;

export const insertApiTestHistorySchema = createInsertSchema(apiTestHistory, {}).omit({ id: true, createdAt: true, userId: true });

export const insertApiTestSchema = createInsertSchema(apiTests, {
  name: z.string().min(1, "Test name cannot be empty"),
  method: z.string().min(1, "HTTP method is required"),
  url: z.string().url("Invalid URL format"),
  module: z.string().optional().nullable(),
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional().nullable(),
  severity: z.enum(['Blocker', 'Critical', 'Major', 'Minor']).optional().nullable(),
}).omit({
  id: true, createdAt: true, updatedAt: true, userId: true, projectId: true,
  queryParams: true, requestHeaders: true, requestBody: true, assertions: true,
  authParams: true, bodyFormData: true, bodyUrlEncoded: true,
}).extend({
  queryParams: z.record(z.string().or(z.array(z.string()))).optional().nullable(),
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
  queryParams: z.record(z.string().or(z.array(z.string()))).optional().nullable(),
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
  id: z.enum(['click', 'input', 'wait', 'scroll', 'assert', 'hover', 'select', 'assertTextContains', 'assertElementCount']),
  type: z.string(), name: z.string(), icon: z.string(), description: z.string(),
});
export type AdhocTestAction = z.infer<typeof AdhocTestActionSchema>;

export const AdhocDetectedElementSchema = z.object({
  id: z.string(), type: z.string(), selector: z.string(), text: z.string().optional().nullable(), tag: z.string(),
  attributes: z.record(z.string()),
  boundingBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
});
export type AdhocDetectedElement = z.infer<typeof AdhocDetectedElementSchema>;

export const AdhocTestStepSchema = z.object({
  id: z.string(), action: AdhocTestActionSchema, targetElement: AdhocDetectedElementSchema.optional(), value: z.string().optional().nullable(),
}).refine(data => {
  if (['click', 'input', 'hover', 'select', 'assert', 'assertTextContains', 'assertElementCount'].includes(data.action.id) && !data.targetElement) return false;
  return true;
}, { message: "targetElement is required for actions like click, input, hover, select, assert, assertTextContains, assertElementCount", path: ['targetElement'] })
.refine(data => {
  if (['input', 'wait', 'select', 'assertTextContains', 'assertElementCount'].includes(data.action.id) && (data.value === undefined || data.value === null || data.value.trim() === '')) return false;
  return true;
}, { message: "A non-empty value is required for input, wait, select, assertTextContains, and assertElementCount actions", path: ['value'] })
.refine(data => {
  if (data.action.id === 'wait') return !isNaN(Number(data.value));
  return true;
}, { message: "For 'wait' action, value must be a number (e.g., '1000' for 1 second)", path: ['value'] });
export type AdhocTestStep = z.infer<typeof AdhocTestStepSchema>;

export const insertSystemSettingSchema = createInsertSchema(systemSettings);
export const selectSystemSettingSchema = createSelectSchema(systemSettings);
