/** What testers write: UI, mobile and load tests, their elements, step groups, data sets, tags, versions and reviews. */
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { ACTION_REQUIREMENTS, ADHOC_ACTION_IDS, STEP_GROUP_ACTION_ID } from '../recording';
import { CUSTOM_ACTION_STEP_ID_PATTERN, type CustomActionParameter } from '../custom-actions';
import type { MobilePlatform, MobileStep, MobileDeviceTarget } from '../mobile';
import type { LoadDataMode, LoadStage, LoadStep, LoadThresholds } from '../load-test';
import { BddTestSchema, type BddTest } from '../bdd';
import { apiTests } from './api-testing';
import { browserGrids } from './environments';
import { organizations, projects, users } from './identity';

export const tests = pgTable(
  'tests',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    sequence: jsonb('sequence').notNull(),
    bdd: jsonb('bdd').$type<BddTest>(),
    elements: jsonb('elements').notNull(),
    // Ordered API setup calls that must succeed before the UI sequence runs, so the
    // system under test is in the required state (e.g. a static scale check before a
    // tare check). Nullable: existing/most tests have none. See PreconditionSchema.
    preconditions: jsonb('preconditions'),
    // API calls after the test, whatever its outcome, that remove what it created (migration 0065,
    // server/cleanup-runner.ts). Nullable: most tests have none. See CleanupSchema.
    cleanups: jsonb('cleanups'),
    /**
     * Rows of input this test runs over, one run each.
     *
     * Each key becomes a {{variable}} for that run, layered over the environment values.
     * Null or empty means one run with no extra variables — what every test did before.
     */
    dataset: jsonb('dataset'),
    status: text('status').notNull().default('draft'),
    /**
     * The version plans run (test_versions.version). Null: never published, and plans run this
     * row — the working copy — as they always did. See migrations/0032_test_publishing.sql.
     */
    publishedVersion: integer('published_version'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),

    // NEW Fields for reporting
    module: text('module'),
    featureArea: text('feature_area'),
    scenario: text('scenario'),
    component: text('component'),
    priority: text('priority').default('Medium'), // enum is handled by app logic/zod
    severity: text('severity').default('Major'),
  },
  (table) => [
    index('tests_user_id_idx').on(table.userId),
    index('tests_project_id_idx').on(table.projectId),
    index('tests_status_idx').on(table.status),
    index('tests_organization_id_idx').on(table.organizationId),
  ],
);

export const testRuns = pgTable(
  'test_runs',
  {
    id: serial('id').primaryKey(),
    testId: integer('test_id')
      .notNull()
      .references(() => tests.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    status: text('status').notNull(),
    results: jsonb('results'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    index('test_runs_test_id_idx').on(table.testId),
    index('test_runs_organization_id_idx').on(table.organizationId),
  ],
);

export const detectedElements = pgTable(
  'detected_elements',
  {
    id: serial('id').primaryKey(),
    testId: integer('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    elementId: text('element_id').notNull(), // Client-side ID like elem-button-1
    selector: text('selector').notNull(),
    originalSelector: text('original_selector'),
    type: text('type'),
    text: text('text'),
    tag: text('tag'),
    attributes: jsonb('attributes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('detected_elements_test_id_idx').on(table.testId),
    index('detected_elements_test_id_element_id_idx').on(table.testId, table.elementId),
    index('detected_elements_organization_id_idx').on(table.organizationId),
  ],
);

// Excel Sequences Map Table
export const excelSequencesMap = pgTable(
  'excel_sequences_map',
  {
    id: serial('id').primaryKey(),
    testId: integer('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Unique per organization, not globally: the id comes from a customer's own spreadsheet, so
    // two tenants using the same one is ordinary. See the unique constraint below.
    excelTestCaseId: text('excel_test_case_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('excel_sequences_map_test_id_idx').on(table.testId),
    index('excel_sequences_map_organization_id_idx').on(table.organizationId),
    unique('excel_sequences_map_org_excel_test_case_id_unique').on(
      table.organizationId,
      table.excelTestCaseId,
    ),
  ],
);

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
export const stepGroups = pgTable(
  'step_groups',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** Nullable like `tests.projectId`: a group may be one application's or the whole tenant's. */
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    /** The same shape as a test's sequence, minus any call to another group — see step-groups.ts. */
    sequence: jsonb('sequence').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('step_groups_organization_id_idx').on(table.organizationId),
    index('step_groups_project_id_idx').on(table.projectId),
  ],
);

export type StepGroup = typeof stepGroups.$inferSelect;
export type InsertStepGroup = typeof stepGroups.$inferInsert;

/**
 * An organization's own step: a name, parameters, and JavaScript that runs in the page under
 * test. Referenced by tests like a step group, never copied into them — see
 * shared/custom-actions.ts for why the script runs in the page and nowhere else.
 */
export const customActions = pgTable(
  'custom_actions',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    description: text('description'),
    parameters: jsonb('parameters').$type<CustomActionParameter[]>().notNull().default([]),
    script: text('script').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('custom_actions_organization_id_idx').on(table.organizationId),
    // One name per organization: it is what the palette shows and what a report names.
    uniqueIndex('custom_actions_organization_name_idx').on(table.organizationId, table.name),
  ],
);

export type CustomAction = typeof customActions.$inferSelect;

/**
 * Data an organization keeps once and every test reuses — see shared/test-data.ts. Read as
 * {{data.<name>.<column>}} by any test, or as the rows a UI test runs over.
 */
export const testDataSets = pgTable(
  'test_data_sets',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description'),
    columns: jsonb('columns').$type<string[]>().notNull(),
    rows: jsonb('rows').$type<Array<Record<string, string>>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('test_data_sets_organization_id_idx').on(table.organizationId),
    // The name is how a test refers to it: {{data.customers.email}}.
    uniqueIndex('test_data_sets_organization_name_idx').on(table.organizationId, table.name),
  ],
);

export type TestDataSet = typeof testDataSets.$inferSelect;

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
export const projectElements = pgTable(
  'project_elements',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** How a person finds it. Unique within the project — see the migration. */
    name: text('name').notNull(),
    selector: text('selector').notNull(),
    /** What it was before healing ever moved it, so "what did this used to be?" has an answer. */
    originalSelector: text('original_selector'),
    /** The iframe chain, ' >> ' separated and outermost first. */
    frameSelector: text('frame_selector'),
    tag: text('tag'),
    elementType: text('element_type'),
    text: text('text'),
    attributes: jsonb('attributes'),
    /** Set when the healing pass repaired it: what the application has been moving underneath. */
    healedAt: timestamp('healed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('project_elements_organization_id_idx').on(table.organizationId),
    index('project_elements_project_id_idx').on(table.projectId),
    unique('project_elements_project_name_unique').on(table.projectId, table.name),
  ],
);

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
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('tags_organization_id_idx').on(table.organizationId)],
);

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
export const testTags = pgTable(
  'test_tags',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    /** A mobile app test (migration 0056). Plain integer here: mobile_tests is declared further down. */
    mobileTestId: integer('mobile_test_id'),
    testType: text('test_type').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('test_tags_organization_id_idx').on(table.organizationId),
    index('test_tags_tag_id_idx').on(table.tagId),
    index('test_tags_test_id_idx').on(table.testId),
    index('test_tags_api_test_id_idx').on(table.apiTestId),
  ],
);

export type TestTag = typeof testTags.$inferSelect;
export type InsertTestTag = typeof testTags.$inferInsert;

/** Which kinds of test a tag can be put on. */
export const TAGGABLE_TYPES = ['ui', 'api', 'mobile'] as const;
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
export const testVersions = pgTable(
  'test_versions',
  {
    bdd: jsonb('bdd').$type<BddTest>(),
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    mobileTestId: integer('mobile_test_id').references((): AnyPgColumn => mobileTests.id, {
      onDelete: 'cascade',
    }),
    /** 1-based and per test, so "version 4" names one row. */
    version: integer('version').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    sequence: jsonb('sequence').notNull(),
    elements: jsonb('elements').notNull(),
    preconditions: jsonb('preconditions'),
    cleanups: jsonb('cleanups'),
    dataset: jsonb('dataset'),
    /** What changed since the version before, worked out when the row is written. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    summary: text('summary'),
    /** Set when this version exists because somebody restored an older one. */
    restoredFromVersion: integer('restored_from_version'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'test_versions_api_test_id_same_org_fk',
      columns: [table.apiTestId, table.organizationId],
      foreignColumns: [apiTests.id, apiTests.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'test_versions_mobile_test_id_same_org_fk',
      columns: [table.mobileTestId, table.organizationId],
      foreignColumns: [mobileTests.id, mobileTests.organizationId],
    }).onDelete('cascade'),
    check(
      'test_versions_typed_snapshot',
      sql`${table.testId} IS NOT NULL OR ${table.snapshot} IS NOT NULL`,
    ),
    check(
      'test_versions_one_target',
      sql`num_nonnulls(${table.testId}, ${table.apiTestId}, ${table.mobileTestId}) = 1`,
    ),
    index('test_versions_organization_id_idx').on(table.organizationId),
    index('test_versions_test_id_idx').on(table.testId),
    unique('test_versions_test_version_unique').on(table.testId, table.version),
    unique('test_versions_api_version_unique').on(table.apiTestId, table.version),
    unique('test_versions_mobile_version_unique').on(table.mobileTestId, table.version),
  ],
);

export type TestVersion = typeof testVersions.$inferSelect;
export type InsertTestVersion = typeof testVersions.$inferInsert;

export const TEST_PUBLICATION_KINDS = ['publish', 'review', 'rollback', 'unpublish'] as const;
export type TestPublicationKind = (typeof TEST_PUBLICATION_KINDS)[number];

/** Every time a version of a test was put live, or taken down. Append-only. */
export const testPublications = pgTable(
  'test_publications',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    mobileTestId: integer('mobile_test_id').references((): AnyPgColumn => mobileTests.id, {
      onDelete: 'cascade',
    }),
    /** Null for an 'unpublish': plans went back to the working copy. */
    version: integer('version'),
    kind: text('kind').$type<TestPublicationKind>().notNull(),
    reviewId: integer('review_id'),
    publishedBy: integer('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'test_publications_api_test_id_same_org_fk',
      columns: [table.apiTestId, table.organizationId],
      foreignColumns: [apiTests.id, apiTests.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'test_publications_mobile_test_id_same_org_fk',
      columns: [table.mobileTestId, table.organizationId],
      foreignColumns: [mobileTests.id, mobileTests.organizationId],
    }).onDelete('cascade'),
    check(
      'test_publications_one_target',
      sql`num_nonnulls(${table.testId}, ${table.apiTestId}, ${table.mobileTestId}) = 1`,
    ),
    index('test_publications_test_id_idx').on(table.testId),
    index('test_publications_organization_id_idx').on(table.organizationId),
  ],
);

export const TEST_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type TestReviewStatus = (typeof TEST_REVIEW_STATUSES)[number];

/** A request to publish one version of a test, and what became of it. */
export const testReviews = pgTable(
  'test_reviews',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
    apiTestId: integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' }),
    mobileTestId: integer('mobile_test_id').references((): AnyPgColumn => mobileTests.id, {
      onDelete: 'cascade',
    }),
    version: integer('version').notNull(),
    status: text('status').$type<TestReviewStatus>().notNull().default('pending'),
    note: text('note'),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at').defaultNow().notNull(),
    decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at'),
    decisionComment: text('decision_comment'),
  },
  (table) => [
    foreignKey({
      name: 'test_reviews_api_test_id_same_org_fk',
      columns: [table.apiTestId, table.organizationId],
      foreignColumns: [apiTests.id, apiTests.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'test_reviews_mobile_test_id_same_org_fk',
      columns: [table.mobileTestId, table.organizationId],
      foreignColumns: [mobileTests.id, mobileTests.organizationId],
    }).onDelete('cascade'),
    check(
      'test_reviews_one_target',
      sql`num_nonnulls(${table.testId}, ${table.apiTestId}, ${table.mobileTestId}) = 1`,
    ),
    index('test_reviews_organization_status_idx').on(table.organizationId, table.status),
    index('test_reviews_test_id_idx').on(table.testId),
  ],
);

export type TestReview = typeof testReviews.$inferSelect;

/**
 * A test of a native Android or iOS app, run on a cloud grid's real device through Appium
 * (shared/mobile.ts, migrations/0052).
 */
export const mobileTests = pgTable(
  'mobile_tests',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    publishedVersion: integer('published_version'),
    name: text('name').notNull(),
    platform: text('platform').$type<MobilePlatform>().notNull(),
    app: text('app').notNull(),
    deviceName: text('device_name').notNull(),
    osVersion: text('os_version'),
    deviceMatrix: jsonb('device_matrix').$type<MobileDeviceTarget[]>().notNull().default([]),
    /** The grid it runs on in a plan (migration 0053). */
    gridId: text('grid_id').references(() => browserGrids.id, { onDelete: 'set null' }),
    steps: jsonb('steps').$type<MobileStep[]>().notNull().default([]),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('mobile_tests_organization_id_idx').on(table.organizationId)],
);

export type MobileTest = typeof mobileTests.$inferSelect;

export const mobileStepGroups = pgTable(
  'mobile_step_groups',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    platform: text('platform').$type<MobilePlatform>().notNull(),
    steps: jsonb('steps').$type<MobileStep[]>().notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('mobile_step_groups_org_idx').on(table.organizationId),
    uniqueIndex('mobile_step_groups_name_unique').on(
      table.organizationId,
      table.platform,
      sql`lower(${table.name})`,
    ),
    foreignKey({
      name: 'mobile_step_groups_project_id_same_org_fk',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }),
  ],
);

/**
 * A load test (shared/load-test.ts): API tests repeated by virtual users along a profile of
 * stages. Run on its own, never inside a plan.
 */
export const loadTests = pgTable(
  'load_tests',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    steps: jsonb('steps').$type<LoadStep[]>().notNull(),
    stages: jsonb('stages').$type<LoadStage[]>().notNull(),
    warmUpSec: integer('warm_up_sec').notNull().default(0),
    dataSetId: integer('data_set_id').references(() => testDataSets.id, { onDelete: 'set null' }),
    dataMode: text('data_mode').$type<LoadDataMode>().notNull().default('vu'),
    thresholds: jsonb('thresholds').$type<LoadThresholds>().notNull().default({}),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('load_tests_org_idx').on(table.organizationId)],
);

export type LoadTest = typeof loadTests.$inferSelect;

// ---- ZOD SCHEMAS AND TYPES for excelSequencesMap ----
export const insertExcelSequencesMapSchema = createInsertSchema(excelSequencesMap, {
  excelTestCaseId: z.string().min(1, 'Excel Test Case ID is required'),
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

/**
 * A cleanup: an API call made after the test, whatever its outcome, to remove what it created
 * (server/cleanup-runner.ts). The request shape of a precondition, without the check: 404 and 410
 * already mean "gone", and `satisfiedStatuses` adds others.
 */
export const CleanupSchema = PreconditionSchema.omit({ check: true });
export type Cleanup = z.infer<typeof CleanupSchema>;

export const insertTestSchema = createInsertSchema(tests, {
  bdd: BddTestSchema.nullable().optional(),
  module: z.string().optional().nullable(), // Zod handles .nullable() correctly for optional fields
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  preconditions: z.array(PreconditionSchema).optional().nullable(),
  cleanups: z.array(CleanupSchema).max(50).optional().nullable(),
  // Rows of input, each key a {{variable}} for that run. Typed rather than raw jsonb so a
  // malformed dataset is refused at save time instead of halfway through a scheduled run.
  dataset: z
    .array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .optional()
    .nullable(),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional().nullable(),
  severity: z.enum(['Blocker', 'Critical', 'Major', 'Minor']).optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Which version runs is changed only by publishing (server/authoring/test-publishing.ts), which checks
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

export const insertTestRunSchema = createInsertSchema(testRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});
export type InsertTest = z.infer<typeof insertTestSchema>;
export type Test = typeof tests.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;
export type TestRun = typeof testRuns.$inferSelect;

export const insertDetectedElementSchema = createInsertSchema(detectedElements).omit({
  id: true,
  createdAt: true,
});

export type DetectedElement = typeof detectedElements.$inferSelect;
export type InsertDetectedElement = z.infer<typeof insertDetectedElementSchema>;

export const AdhocTestActionSchema = z.object({
  // Keep in sync with ADHOC_ACTION_IDS in shared/recording.ts, which drives the
  // recorder → builder mapping.
  //
  // Plus the one step that is not an action on a page: a call to a step group. It is accepted
  // here because a test may hold one, and it is deliberately not in ADHOC_ACTION_IDS because
  // the step executor's exhaustive table is what guarantees every *action* has an
  // implementation — and this one is replaced by the group's own steps before the executor
  // runs. See server/step-groups.ts.
  //
  // And a call to one of the organization's custom actions, `customAction:<id>`, which the
  // runner replaces with the action's script the same way (server/authoring/custom-actions.ts).
  id: z.union([
    z.enum(ADHOC_ACTION_IDS),
    z.literal(STEP_GROUP_ACTION_ID),
    z.string().regex(CUSTOM_ACTION_STEP_ID_PATTERN),
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
  return (
    ACTION_REQUIREMENTS as Record<
      string,
      { target: boolean; value: boolean; valueRequired: boolean } | undefined
    >
  )[id];
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
    message: 'This action needs an element to act on.',
    path: ['targetElement'],
  })
  .refine(
    (data) =>
      !requirementsFor(data.action.id)?.valueRequired ||
      (typeof data.value === 'string' && data.value.trim() !== ''),
    {
      message: 'This action needs a non-empty value.',
      path: ['value'],
    },
  )
  .refine(
    (data) => {
      if (data.action.id === 'wait') return !isNaN(Number(data.value));
      return true;
    },
    {
      message: "For 'wait' action, value must be a number (e.g., '1000' for 1 second)",
      path: ['value'],
    },
  )
  .refine(
    (data) => {
      // A recorded navigation replays as page.goto(value), so the value must be a URL.
      if (data.action.id !== 'navigate') return true;
      try {
        new URL(data.value ?? '');
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "For 'navigate' action, value must be an absolute URL",
      path: ['value'],
    },
  );
export type AdhocTestStep = z.infer<typeof AdhocTestStepSchema>;
