import { check, index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { organizations, users, tests, apiTests, mobileTests, reportTestCaseResults } from './schema';

export const COMMENT_KINDS = ['ui', 'api', 'mobile', 'result'] as const;
export type CommentKind = typeof COMMENT_KINDS[number];
export const commentBodySchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
  uiTestId: integer('ui_test_id').references(() => tests.id, { onDelete: 'cascade' }),
  apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
  mobileTestId: integer('mobile_test_id').references(() => mobileTests.id, { onDelete: 'cascade' }),
  resultId: text('result_id').references(() => reportTestCaseResults.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, table => [
  check('comments_one_target', sql`num_nonnulls(${table.uiTestId}, ${table.apiTestId}, ${table.mobileTestId}, ${table.resultId}) = 1`),
  check('comments_body_length', sql`length(btrim(${table.body})) BETWEEN 1 AND 5000`),
  index('comments_ui_idx').on(table.uiTestId), index('comments_api_idx').on(table.apiTestId),
  index('comments_mobile_idx').on(table.mobileTestId), index('comments_result_idx').on(table.resultId),
]);
export type CommentRecord = typeof comments.$inferSelect;
