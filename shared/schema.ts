import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations, sql } from 'drizzle-orm';

// Table Definitions
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
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
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const tests = sqliteTable("tests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sequence: text("sequence", { mode: 'json' }).notNull(), // Array of test steps
  elements: text("elements", { mode: 'json' }).notNull(), // Detected DOM elements
  status: text("status").notNull().default("draft"), // draft, saved, executing, completed
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const testRuns = sqliteTable("test_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  testId: integer("test_id").notNull().references(() => tests.id),
  status: text("status").notNull(), // running, completed, failed
  results: text("results", { mode: 'json' }), // Execution results and logs
  startedAt: text("started_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  completedAt: text("completed_at"),
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
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
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
  authType: text("auth_type"), // Nullable by default
  authParams: text("auth_params", { mode: 'json' }), // Nullable
  bodyType: text("body_type"), // Nullable
  bodyRawContentType: text("body_raw_content_type"), // Nullable
  bodyFormData: text("body_form_data", { mode: 'json' }), // Nullable
  bodyUrlEncoded: text("body_url_encoded", { mode: 'json' }), // Nullable
  bodyGraphqlQuery: text("body_graphql_query"), // Nullable
  bodyGraphqlVariables: text("body_graphql_variables"), // Nullable
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// Relation Definitions
export const usersRelations = relations(users, ({ many, one }) => ({
  userSettings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  projects: many(projects),
  tests: many(tests), // user can have tests not associated with a project
  apiTestHistory: many(apiTestHistory),
  apiTests: many(apiTests),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  tests: many(tests),
  apiTests: many(apiTests),
}));

export const testsRelations = relations(tests, ({ one, many }) => ({
  user: one(users, {
    fields: [tests.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [tests.projectId],
    references: [projects.id],
  }),
  runs: many(testRuns),
}));

export const testRunsRelations = relations(testRuns, ({ one }) => ({
  test: one(tests, {
    fields: [testRuns.testId],
    references: [tests.id],
  }),
}));

export const apiTestHistoryRelations = relations(apiTestHistory, ({ one }) => ({
  user: one(users, {
      fields: [apiTestHistory.userId],
      references: [users.id],
  }),
}));

export const apiTestsRelations = relations(apiTests, ({ one, many }) => ({
  user: one(users, {
      fields: [apiTests.userId],
      references: [users.id],
  }),
  project: one(projects, {
      fields: [apiTests.projectId],
      references: [projects.id],
  }),
}));

// Zod Schemas for Insertions
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTestSchema = createInsertSchema(tests).omit({
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
  'inherit', // Inherit auth from parent
  'none',    // No Auth
  'basic',   // Basic Auth
  'bearer',  // Bearer Token
  'jwtBearer', // JWT Bearer
  'digest',  // Digest Auth
  'oauth1',  // OAuth 1.0
  'oauth2',  // OAuth 2.0
  'hawk',    // Hawk Authentication
  'aws',     // AWS Signature
  'ntlm',    // NTLM Authentication
  'apiKey',  // API Key
  'akamai',  // Akamai EdgeGrid
  'asap',    // ASAP
]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const BasicAuthParamsSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type BasicAuthParams = z.infer<typeof BasicAuthParamsSchema>;

export const BearerTokenAuthParamsSchema = z.object({
  token: z.string(),
});
export type BearerTokenAuthParams = z.infer<typeof BearerTokenAuthParamsSchema>;

export const ApiKeyAuthParamsSchema = z.object({
  key: z.string(),
  value: z.string(),
  addTo: z.enum(['header', 'query']),
});
export type ApiKeyAuthParams = z.infer<typeof ApiKeyAuthParamsSchema>;

// Discriminated union for Auth Params
export const AuthParamsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(AuthTypeSchema.enum.basic), params: BasicAuthParamsSchema }),
  z.object({ type: z.literal(AuthTypeSchema.enum.bearer), params: BearerTokenAuthParamsSchema }),
  z.object({ type: z.literal(AuthTypeSchema.enum.apiKey), params: ApiKeyAuthParamsSchema }),
  // TODO: Add other auth types here as their param schemas are defined
  // For now, include stubs for other types to make the discriminated union comprehensive
  // These can be refined later.
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

// --- API Body Schemas ---
// Re-define bodyTypes array here or import if it becomes available from a central place
const bodyTypesArray = ['none', 'form-data', 'x-www-form-urlencoded', 'raw', 'binary', 'GraphQL'] as const;
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
    type: z.literal('text'),
    value: z.string(),
  }),
  z.object({
    id: z.string(),
    key: z.string(),
    enabled: z.boolean(),
    type: z.literal('file'),
    fileName: z.string(),
    fileType: z.string(),
    // value will not be stored directly for files, just metadata
  }),
]);
export type FormDataFieldMetadata = z.infer<typeof FormDataFieldMetadataSchema>;


// --- Insert/Update Schemas for API Tests & History ---
export const insertApiTestHistorySchema = createInsertSchema(apiTestHistory, {
  // Define any specific Zod types for fields if needed, e.g., for JSON fields
  // Omit fields that are auto-generated or should not be set directly by client
}).omit({ id: true, createdAt: true, userId: true }); // userId will be from session

export const insertApiTestSchema = createInsertSchema(apiTests, {
  name: z.string().min(1, "Test name cannot be empty"),
  method: z.string().min(1, "HTTP method is required"),
  url: z.string().url("Invalid URL format"),
  // queryParams, requestHeaders, requestBody, assertions are handled by .extend() or directly on apiTests schema
}).omit({
  id: true, createdAt: true, updatedAt: true, userId: true, projectId: true,
  // Explicitly omit text fields that store JSON and will be handled by .extend with Zod array/object types
  queryParams: true, requestHeaders: true, requestBody: true, assertions: true,
  authParams: true, bodyFormData: true, bodyUrlEncoded: true, // Omit new JSON fields too
}).extend({
  queryParams: z.record(z.string().or(z.array(z.string()))).optional().nullable(),
  requestHeaders: z.record(z.string()).optional().nullable(),
  requestBody: z.any().optional().nullable(), // Keep as any for flexibility, will be stringified for old 'requestBody'
  assertions: z.array(AssertionSchema).optional().nullable(),

  // New fields for structured auth and body
  authType: AuthTypeSchema.optional().nullable(),
  authParams: AuthParamsSchema.optional().nullable(), // This is already a Zod schema
  bodyType: BodyTypeSchema.optional().nullable(),
  bodyRawContentType: z.string().optional().nullable(),
  bodyFormData: z.array(FormDataFieldMetadataSchema).optional().nullable(),
  bodyUrlEncoded: z.array(KeyValuePairSchema).optional().nullable(),
  bodyGraphqlQuery: z.string().optional().nullable(),
  bodyGraphqlVariables: z.string().optional().nullable(), // Keep as string, parsed by client/server
});

export const updateApiTestSchema = insertApiTestSchema.partial().extend({
  // Ensure even in partial updates, these fields are validated against their Zod types if provided
  // All fields from insertApiTestSchema are already optional due to .partial()
  // We just need to ensure the .extend() part is also applied if they are provided
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

// Schemas for Adhoc Execution Payload Validation
// Make sure this section remains *after* all table schema, relations, Zod insert schemas, and type exports

export const AdhocTestActionSchema = z.object({
  id: z.enum([
    'click',
    'input',
    'wait',
    'scroll',
    'assert',
    'hover',
    'select',
    'assertTextContains',
    'assertElementCount'
  ]),
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
  text: z.string().optional().nullable(),
  tag: z.string(),
  attributes: z.record(z.string()),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});
export type AdhocDetectedElement = z.infer<typeof AdhocDetectedElementSchema>;

export const AdhocTestStepSchema = z.object({
  id: z.string(),
  action: AdhocTestActionSchema,
  targetElement: AdhocDetectedElementSchema.optional(),
  value: z.string().optional().nullable(),
}).refine(data => {
  if (['click', 'input', 'hover', 'select', 'assert', 'assertTextContains', 'assertElementCount'].includes(data.action.id) && !data.targetElement) {
    return false;
  }
  return true;
}, {
  message: "targetElement is required for actions like click, input, hover, select, assert, assertTextContains, assertElementCount",
  path: ['targetElement'],
}).refine(data => {
  if (['input', 'wait', 'select', 'assertTextContains', 'assertElementCount'].includes(data.action.id) && (data.value === undefined || data.value === null || data.value.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: "A non-empty value is required for input, wait, select, assertTextContains, and assertElementCount actions",
  path: ['value'],
}).refine(data => {
  if (data.action.id === 'wait') {
    return !isNaN(Number(data.value));
  }
  return true;
}, {
  message: "For 'wait' action, value must be a number (e.g., '1000' for 1 second)",
  path: ['value'],
});
export type AdhocTestStep = z.infer<typeof AdhocTestStepSchema>;
