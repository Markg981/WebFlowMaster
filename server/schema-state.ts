import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privilegedDb, type DbType } from './db';

/**
 * Which of three states the database schema is in.
 *
 * The README's first-run step was `npm run db:push`, which creates the tables from
 * shared/schema.ts and records nothing in the migration journal. From then on `db:migrate`
 * fails forever on the first table it finds already present, reporting
 * `relation "api_test_history" already exists` — a symptom with no cause and no remedy in
 * it. And because nothing else could run either, the migrations that add row-level security
 * and the audit-table grants were never applied, while the app booted regardless: the
 * tenancy precondition check in db.ts returns early on PGlite, where it is all trivially
 * true because PGlite connects as a superuser.
 *
 * A database built the documented way was therefore both unmigratable and not isolating
 * tenants, and announced neither. This module is what makes the difference visible.
 */

export type SchemaStateKind =
  /** Nothing there yet: migrations will create everything. */
  | 'empty'
  /** Journal matches the migrations folder. */
  | 'ready'
  /** Tables exist but there is no journal — almost always drizzle-kit push. */
  | 'unmanaged'
  /** Journal exists but is missing entries the folder has. */
  | 'behind';

export interface SchemaState {
  kind: SchemaStateKind;
  appliedMigrations: number;
  expectedMigrations: number;
  /** Whether any application table exists, regardless of journal. */
  hasTables: boolean;
}

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/** How many migrations the repository expects, read from drizzle's own journal file. */
export function expectedMigrationCount(folder = migrationsFolder): number {
  const journalPath = path.join(folder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) return 0;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries?: unknown[] };
  return journal.entries?.length ?? 0;
}

export async function inspectSchemaState(db: DbType = privilegedDb): Promise<SchemaState> {
  const expectedMigrations = expectedMigrationCount();

  // Both questions in one round-trip, and both tolerant of the objects being absent —
  // which is the normal case for exactly the states this function exists to name.
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE')  AS table_count,
      EXISTS (SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'drizzle'
           AND table_name = '__drizzle_migrations')                    AS journal_exists
  `);

  const row = (result.rows[0] ?? {}) as { table_count: string | number; journal_exists: boolean };
  const hasTables = Number(row.table_count) > 0;

  let appliedMigrations = 0;
  if (row.journal_exists) {
    const applied = await db.execute(
      sql`SELECT count(*) AS n FROM "drizzle"."__drizzle_migrations"`,
    );
    appliedMigrations = Number((applied.rows[0] as { n: string | number }).n);
  }

  let kind: SchemaStateKind;
  if (hasTables && appliedMigrations === 0) {
    // Tables, and nothing recorded as having created them. Either there is no journal at
    // all (plain `db:push`) or there is an empty one — which is what `db:push` followed by
    // `db:migrate` leaves behind, since the migrator creates its journal table before
    // failing on the first table it finds already present. Both mean the same thing, and
    // reading the second as "one migration behind" would send the reader to run the very
    // command that cannot work.
    kind = 'unmanaged';
  } else if (!row.journal_exists) {
    kind = 'empty';
  } else if (appliedMigrations >= expectedMigrations) {
    kind = 'ready';
  } else {
    kind = 'behind';
  }

  return { kind, appliedMigrations, expectedMigrations, hasTables };
}

/** A message that says what is wrong and what to run. */
export function describeSchemaState(state: SchemaState): string {
  switch (state.kind) {
    case 'empty':
      return 'The database is empty. Run `npm run db:migrate` to create the schema.';

    case 'ready':
      return `Schema is up to date (${state.appliedMigrations} migrations applied).`;

    case 'unmanaged':
      return [
        'The database has tables but no migration journal, so its schema was created',
        'outside the migration system — almost certainly by `npm run db:push`, which an',
        'earlier version of the README recommended for first-time setup.',
        '',
        'Two consequences, neither of which reports itself:',
        '  * `npm run db:migrate` can never run: it will fail on the first table it finds',
        '    already present, and stop before applying anything.',
        '  * the migrations that are not derivable from shared/schema.ts were skipped —',
        '    row-level security (0004-0006) and the append-only audit grants (0009) among',
        '    them. Tenant isolation depends on those, and its absence is silent.',
        '',
        'For a local development database, delete it and start again:',
        '  rm -rf ./data/local-pg && npm run db:migrate',
        '',
        'For a database with data worth keeping, baseline it deliberately: apply the',
        'migrations it is missing by hand, then insert the corresponding journal rows.',
        '`npm run db:push` is for iterating on the schema against a throwaway database,',
        'never against one you intend to migrate later.',
      ].join('\n');

    case 'behind':
      return [
        `The database is ${state.expectedMigrations - state.appliedMigrations} migration(s)`,
        `behind the repository (${state.appliedMigrations} of ${state.expectedMigrations}`,
        'applied). Run `npm run db:migrate`.',
      ].join(' ');
  }
}
