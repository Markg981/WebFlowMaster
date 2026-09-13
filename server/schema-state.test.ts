import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSchemaState, describeSchemaState } from './schema-state';

/**
 * Telling apart the three states a database can be in on first run.
 *
 * The README said `npm run db:push`, which creates the tables from shared/schema.ts and
 * records nothing in the migration journal. From that moment `db:migrate` fails forever on
 * the first table it finds already there — the error being `relation "api_test_history"
 * already exists`, which names a symptom and no cause. Nothing else could run either, so
 * the migrations that add organization_id, row-level security and the audit grants were
 * never applied, and the app booted anyway: on PGlite the tenancy precondition check
 * returns early, because PGlite connects as a superuser for whom it is all trivially true.
 *
 * So a database built the documented way was both unmigratable and not actually isolating
 * tenants, and said so in neither case.
 */

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/** A throwaway in-memory database, so each case starts from nothing. */
async function freshDb() {
  const client = new PGlite('memory://');
  return { client, db: drizzle(client) };
}

describe('inspectSchemaState', () => {
  it('calls an untouched database empty', async () => {
    const { client, db } = await freshDb();
    try {
      const state = await inspectSchemaState(db as never);

      expect(state.kind).toBe('empty');
      expect(state.appliedMigrations).toBe(0);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('calls a properly migrated database ready', async () => {
    const { client, db } = await freshDb();
    try {
      await migrate(db as never, { migrationsFolder });

      const state = await inspectSchemaState(db as never);

      expect(state.kind).toBe('ready');
      expect(state.appliedMigrations).toBe(state.expectedMigrations);
      expect(state.expectedMigrations).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('calls a db:push database unmanaged, because that is the trap', async () => {
    const { client, db } = await freshDb();
    try {
      // What drizzle-kit push leaves behind: tables from the schema, no journal.
      await client.exec('CREATE TABLE "users" ("id" serial PRIMARY KEY, "username" text)');

      const state = await inspectSchemaState(db as never);

      expect(state.kind).toBe('unmanaged');
      // The message has to say what to do. "relation already exists" does not.
      expect(describeSchemaState(state)).toMatch(/db:push/i);
      expect(describeSchemaState(state)).toMatch(/db:migrate/i);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('still calls it unmanaged after a failed migrate left an empty journal', async () => {
    const { client, db } = await freshDb();
    try {
      // The state the trap actually produces. `db:push` creates the tables; the `db:migrate`
      // that follows creates the journal table, fails on the first table already present,
      // and records nothing. A journal that exists but is empty, next to tables that do,
      // is not a database one migration behind — it is one built outside the system.
      await client.exec('CREATE TABLE "users" ("id" serial PRIMARY KEY, "username" text)');
      await client.exec('CREATE SCHEMA IF NOT EXISTS "drizzle"');
      await client.exec(
        'CREATE TABLE "drizzle"."__drizzle_migrations" ' +
          '("id" serial PRIMARY KEY, "hash" text NOT NULL, "created_at" bigint)',
      );

      const state = await inspectSchemaState(db as never);

      expect(state.kind).toBe('unmanaged');
      expect(describeSchemaState(state)).toMatch(/db:push/i);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('calls a partially migrated database behind, and says by how much', async () => {
    const { client, db } = await freshDb();
    try {
      await migrate(db as never, { migrationsFolder });
      // Simulate a deployment left on an older release: drop the newest journal entries.
      await client.exec(
        'DELETE FROM "drizzle"."__drizzle_migrations" WHERE id IN ' +
          '(SELECT id FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 2)',
      );

      const state = await inspectSchemaState(db as never);

      expect(state.kind).toBe('behind');
      expect(state.expectedMigrations - state.appliedMigrations).toBe(2);
      expect(describeSchemaState(state)).toMatch(/db:migrate/i);
    } finally {
      await client.close();
    }
  }, 120_000);
});
