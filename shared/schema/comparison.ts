/** Run comparison (migration 0110): one plan run on two environments and compared step by step. */
import { pgTable, text, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  ComparisonDifference,
  ComparisonMode,
  ComparisonResultVerdict,
  ComparisonReviewStatus,
  ComparisonStatus,
  ComparisonSummary,
  ComparisonVerdict,
  DifferenceKind,
} from '../comparison';
import { apiTests } from './api-testing';
import { tests } from './authoring';
import { environments } from './environments';
import { reportTestCaseResults, testPlanExecutions, testPlans } from './execution';
import { organizations, projects, users } from './identity';

/**
 * A comparison: a baseline run and a candidate run of one frozen plan on two environments.
 *
 * The environment names are copied when it is created, so the comparison still says what it
 * compared after an environment is deleted. `status` is written only by `transitionComparison`.
 */
export const comparisonRuns = pgTable(
  'comparison_runs',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testPlanId: text('test_plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    name: text('name'),
    baselineEnvironmentId: integer('baseline_environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    candidateEnvironmentId: integer('candidate_environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    baselineEnvironmentName: text('baseline_environment_name').notNull(),
    candidateEnvironmentName: text('candidate_environment_name').notNull(),
    baselineExecutionId: text('baseline_execution_id').references(() => testPlanExecutions.id, {
      onDelete: 'set null',
    }),
    candidateExecutionId: text('candidate_execution_id').references(() => testPlanExecutions.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<ComparisonMode>().notNull().default('sequential'),
    /** ComparisonPolicy, read through `comparisonPolicyOf`. */
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<ComparisonStatus>().notNull().default('queued'),
    verdict: text('verdict').$type<ComparisonVerdict>(),
    summary: jsonb('summary').$type<ComparisonSummary>(),
    /** Why it ended in error, or `candidate_deferred` while the candidate waits for quota. */
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    idempotencyKey: text('idempotency_key'),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    index('comparison_runs_plan_idx').on(table.testPlanId, table.createdAt),
    index('comparison_runs_baseline_execution_idx').on(table.baselineExecutionId),
    index('comparison_runs_candidate_execution_idx').on(table.candidateExecutionId),
    index('comparison_runs_open_idx')
      .on(table.status)
      .where(sql`status IN ('queued', 'running', 'comparing')`),
    uniqueIndex('comparison_runs_idempotency_idx')
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  ],
);

export type ComparisonRun = typeof comparisonRuns.$inferSelect;

/** One test of a comparison: the two results it paired and the verdict it reached. */
export const comparisonResults = pgTable(
  'comparison_results',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    comparisonRunId: text('comparison_run_id')
      .notNull()
      .references(() => comparisonRuns.id, { onDelete: 'cascade' }),
    /** What paired the two results: test type, test id, browser, configuration and dataset row. */
    pairKey: text('pair_key').notNull(),
    uiTestId: integer('ui_test_id').references(() => tests.id, { onDelete: 'set null' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'set null' }),
    testType: text('test_type'),
    testName: text('test_name'),
    browser: text('browser'),
    module: text('module'),
    component: text('component'),
    priority: text('priority'),
    severity: text('severity'),
    baselineResultId: text('baseline_result_id').references(() => reportTestCaseResults.id, {
      onDelete: 'set null',
    }),
    candidateResultId: text('candidate_result_id').references(() => reportTestCaseResults.id, {
      onDelete: 'set null',
    }),
    verdict: text('verdict').$type<ComparisonResultVerdict>().notNull(),
    differences: jsonb('differences').$type<ComparisonDifference[]>().notNull().default([]),
    baselineDurationMs: integer('baseline_duration_ms'),
    candidateDurationMs: integer('candidate_duration_ms'),
    reviewStatus: text('review_status').$type<ComparisonReviewStatus>().notNull().default('open'),
    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('comparison_results_pair_idx').on(table.comparisonRunId, table.pairKey),
    index('comparison_results_baseline_result_idx').on(table.baselineResultId),
    index('comparison_results_candidate_result_idx').on(table.candidateResultId),
  ],
);

export type ComparisonResult = typeof comparisonResults.$inferSelect;

/** An approved exception: a difference later comparisons recognise instead of reporting. */
export const comparisonKnownDifferences = pgTable(
  'comparison_known_differences',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** Null: the whole organization. */
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    uiTestId: integer('ui_test_id').references(() => tests.id, { onDelete: 'cascade' }),
    /** Null: any checkpoint. */
    checkpointName: text('checkpoint_name'),
    kind: text('kind').$type<DifferenceKind>().notNull(),
    /** A glob over the difference path. */
    pathPattern: text('path_pattern'),
    reason: text('reason').notNull(),
    reference: text('reference'),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    index('comparison_known_differences_scope_idx').on(
      table.organizationId,
      table.projectId,
      table.uiTestId,
    ),
  ],
);

export type ComparisonKnownDifference = typeof comparisonKnownDifferences.$inferSelect;
