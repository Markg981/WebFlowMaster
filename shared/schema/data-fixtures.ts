/**
 * The data fixture library (migration 0117): fixtures kept once per project, in versions, and
 * named by the tests that need them (shared/schema/authoring.ts, DataFixtureRefSchema).
 */
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { LibraryFixtureDefinition } from './authoring';
import { organizations, projects, users } from './identity';

export const dataFixtureLibrary = pgTable(
  'data_fixture_library',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The slug dependencies name it by; unique in the project and never changed. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** `sql` for now; the library is meant to hold API set-ups too. */
    kind: text('kind').notNull().default('sql'),
    tags: text('tags').array().notNull().default([]),
    /** The version a reference with `version: 'latest'` runs. */
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('data_fixture_library_project_key_unique').on(table.projectId, table.key),
    index('data_fixture_library_org_idx').on(table.organizationId),
  ],
);
export type LibraryFixture = typeof dataFixtureLibrary.$inferSelect;

/** Each saved state of a library fixture. Written once, never updated: a run may have used it. */
export const dataFixtureVersions = pgTable(
  'data_fixture_versions',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    fixtureId: integer('fixture_id')
      .notNull()
      .references(() => dataFixtureLibrary.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<LibraryFixtureDefinition>().notNull(),
    /** What changed, in the author's words. */
    note: text('note'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('data_fixture_versions_fixture_version_unique').on(table.fixtureId, table.version),
  ],
);
export type LibraryFixtureVersion = typeof dataFixtureVersions.$inferSelect;

/** What a teardown needs once the run that applied the fixture is gone (migration 0119). */
export interface LedgerEntry {
  name: string;
  alias: string;
  connection: string | null;
  timeoutMs: number | null;
  /** The teardown script, as frozen in the run. */
  teardown: string;
  /** Each parameter with the text it had when `apply` ran (generators already resolved). */
  params: Array<{
    name: string;
    type: 'string' | 'int' | 'decimal' | 'bool' | 'date';
    value: string;
  }>;
  /** `library-key vN` when the fixture came from the library. */
  source?: string;
}

export const FIXTURE_LEDGER_STATUSES = [
  'applying',
  'pending',
  'running',
  'done',
  'failed',
  'kept',
] as const;
export type FixtureLedgerStatus = (typeof FIXTURE_LEDGER_STATUSES)[number];

/**
 * The fixtures a run applied and has not yet torn down (migration 0119). A row is written when
 * `apply` has made the data and settled when the teardown ran, so a worker that dies in between
 * leaves a `pending` row that a person, or the sweep, can still run.
 */
export const fixtureLedger = pgTable(
  'fixture_ledger',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** The plan run (or ad-hoc run) that applied it. Not a foreign key: the row outlives runs. */
    runId: text('run_id').notNull(),
    testId: integer('test_id'),
    /** Where to run the teardown from again; null once the environment is deleted. */
    environmentId: integer('environment_id'),
    alias: text('alias').notNull(),
    name: text('name').notNull(),
    /** `always` | `onSuccess` | `never`, as the test asked. */
    policy: text('policy').notNull().default('always'),
    entry: jsonb('entry').$type<LedgerEntry>().notNull(),
    /** The {{fx.*}} outputs and run values the teardown reads, as they were at apply time. */
    bindings: jsonb('bindings').$type<Record<string, string>>().notNull().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Why it failed or was kept, redacted. */
    detail: text('detail'),
    appliedAt: timestamp('applied_at').defaultNow().notNull(),
    claimedAt: timestamp('claimed_at'),
    settledAt: timestamp('settled_at'),
  },
  (table) => [
    index('fixture_ledger_org_status_idx').on(table.organizationId, table.status),
    index('fixture_ledger_run_idx').on(table.runId),
  ],
);
export type FixtureLedgerRow = typeof fixtureLedger.$inferSelect;
