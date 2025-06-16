import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations, sql } from 'drizzle-orm'; // Reverted: Removed one and many

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const tests = sqliteTable("tests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
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

export const usersRelations = relations(users, ({ many, one }) => ({ // Added 'one' to destructuring
  tests: many(tests),
  userSettings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
}));

export const testsRelations = relations(tests, ({ one, many }) => ({
  user: one(users, {
    fields: [tests.userId],
    references: [users.id],
  }),
  runs: many(testRuns),
}));

export const testRunsRelations = relations(testRuns, ({ one }) => ({
  test: one(tests, {
    fields: [testRuns.testId],
    references: [tests.id],
  }),
}));

export const userSettings = sqliteTable("user_settings", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  theme: text("theme").default('light').notNull(),
  defaultTestUrl: text("default_test_url"),
  playwrightBrowser: text("playwright_browser").default('chromium').notNull(),
  playwrightHeadless: integer("playwright_headless", { mode: 'boolean' }).default(true).notNull(),
  playwrightDefaultTimeout: integer("playwright_default_timeout").default(30000).notNull(),
  playwrightWaitTime: integer("playwright_wait_time").default(1000).notNull(),
});

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTestSchema = createInsertSchema(tests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTestRunSchema = createInsertSchema(testRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTest = z.infer<typeof insertTestSchema>;
export type Test = typeof tests.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;
export type TestRun = typeof testRuns.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

// Schemas for Adhoc Execution Payload Validation

// Mirrors TestAction interface in server/playwright-service.ts
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
  ]), // Action type
  type: z.string(), // Typically same as id, or could be a category.
  name: z.string(), // User-friendly name
  icon: z.string(),
  description: z.string(),
});
export type AdhocTestAction = z.infer<typeof AdhocTestActionSchema>;

// Mirrors DetectedElement interface in server/playwright-service.ts
export const AdhocDetectedElementSchema = z.object({
  id: z.string(), // Client-generated unique ID for the element
  type: z.string(), // e.g., 'button', 'input', 'link'
  selector: z.string(),
  text: z.string().optional().nullable(), // Text content, can be empty
  tag: z.string(),
  attributes: z.record(z.string()), // Record<string, string>
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});
export type AdhocDetectedElement = z.infer<typeof AdhocDetectedElementSchema>;

// Mirrors TestStep interface in server/playwright-service.ts for ad-hoc execution
export const AdhocTestStepSchema = z.object({
  id: z.string(), // Client-side unique ID for this step instance
  action: AdhocTestActionSchema,
  targetElement: AdhocDetectedElementSchema.optional(),
  value: z.string().optional().nullable(), // Value for actions like input, wait duration etc.
}).refine(data => { // Ensure targetElement is present for actions that require it
  if (['click', 'input', 'hover', 'select', 'assert', 'assertTextContains', 'assertElementCount'].includes(data.action.id) && !data.targetElement) {
    return false;
  }
  return true;
}, {
  message: "targetElement is required for actions like click, input, hover, select, assert, assertTextContains, assertElementCount",
  path: ['targetElement'], // Path of the error
}).refine(data => { // Ensure value is present for actions that require it
  if (['input', 'wait', 'select', 'assertTextContains', 'assertElementCount'].includes(data.action.id) && (data.value === undefined || data.value === null || data.value.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: "A non-empty value is required for input, wait, select, assertTextContains, and assertElementCount actions",
  path: ['value'],
}).refine(data => { // Ensure wait value is a number
  if (data.action.id === 'wait') {
    return !isNaN(Number(data.value));
  }
  return true;
}, {
  message: "For 'wait' action, value must be a number (e.g., '1000' for 1 second)",
  path: ['value'],
});
export type AdhocTestStep = z.infer<typeof AdhocTestStepSchema>;
