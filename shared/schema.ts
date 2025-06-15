import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations, sql } from 'drizzle-orm';

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

export const usersRelations = relations(users, ({ many }) => ({
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
