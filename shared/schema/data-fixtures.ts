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
