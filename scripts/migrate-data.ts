import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { pgTable, text as pgText, serial, integer as pgInteger, jsonb, timestamp as pgTimestamp } from 'drizzle-orm/pg-core';
import * as schemaSqlite from '../shared/schema'; // For SQLite target schema
import { sql } from 'drizzle-orm';

// Ensure ws is available for neonConfig in Node.js environment
neonConfig.webSocketConstructor = ws;

// --- Environment Variables ---
const neonDbUrl = process.env.NEON_DATABASE_URL;
const sqliteDbUrl = process.env.SQLITE_DATABASE_URL;

if (!neonDbUrl) {
  throw new Error('NEON_DATABASE_URL environment variable is required for the source database.');
}
if (!sqliteDbUrl) {
  throw new Error('SQLITE_DATABASE_URL environment variable is required for the target SQLite database.');
}

// --- Schema Definitions for Source NeonDB (PostgreSQL) ---
// These are simplified and match the original structure for reading.

const usersPg = pgTable("users", {
  id: serial("id").primaryKey(),
  username: pgText("username").notNull().unique(),
  password: pgText("password").notNull(),
  createdAt: pgTimestamp("created_at").defaultNow().notNull(),
});

const testsPg = pgTable("tests", {
  id: serial("id").primaryKey(),
  userId: pgInteger("user_id").notNull().references(() => usersPg.id),
  name: pgText("name").notNull(),
  url: pgText("url").notNull(),
  sequence: jsonb("sequence").notNull(),
  elements: jsonb("elements").notNull(),
  status: pgText("status").notNull().default("draft"),
  createdAt: pgTimestamp("created_at").defaultNow().notNull(),
  updatedAt: pgTimestamp("updated_at").defaultNow().notNull(),
});

const testRunsPg = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  testId: pgInteger("test_id").notNull().references(() => testsPg.id),
  status: pgText("status").notNull(),
  results: jsonb("results"),
  startedAt: pgTimestamp("started_at").defaultNow().notNull(),
  completedAt: pgTimestamp("completed_at"),
});


async function migrateData() {
  console.log('Starting data migration...');

  // --- Connect to Source NeonDB (PostgreSQL) ---
  console.log('Connecting to source NeonDB...');
  const pool = new Pool({ connectionString: neonDbUrl });
  const dbNeon = drizzleNeon(pool, { schema: { usersPg, testsPg, testRunsPg } });
  console.log('Connected to NeonDB.');

  // --- Connect to Target SQLite DB ---
  console.log(`Connecting to target SQLite DB at ${sqliteDbUrl}...`);
  const sqlite = new Database(sqliteDbUrl); // Can add { verbose: console.log } for debugging
  const dbSqlite = drizzleSqlite(sqlite, { schema: schemaSqlite });
  console.log('Connected to SQLite DB.');

  try {
    // --- Migrate Users ---
    console.log('Fetching users from NeonDB...');
    const allUsersPg = await dbNeon.select().from(usersPg);
    console.log(`Fetched ${allUsersPg.length} users.`);
    if (allUsersPg.length > 0) {
      console.log('Inserting users into SQLite DB...');
      // Drizzle for SQLite expects dates as string or number depending on column type
      // Our schema uses text for createdAt, so it should be fine.
      // If original 'createdAt' is a Date object, it needs to be formatted if Drizzle doesn't handle it.
      // However, Drizzle's default behavior for timestamps (especially with `sql` default) should handle this.
      // For `defaultNow()` from PG, it will be a Date object.
      const usersToInsert = allUsersPg.map(u => ({
        ...u,
        createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
      }));
      await dbSqlite.insert(schemaSqlite.users).values(usersToInsert).onConflictDoNothing(); // Or .onConflictDoUpdate if needed
      console.log('Users migration completed.');
    }

    // --- Migrate Tests ---
    console.log('Fetching tests from NeonDB...');
    const allTestsPg = await dbNeon.select().from(testsPg);
    console.log(`Fetched ${allTestsPg.length} tests.`);
    if (allTestsPg.length > 0) {
      console.log('Inserting tests into SQLite DB...');
      // sequence and elements are jsonb in PG, text({mode: 'json'}) in SQLite
      // Drizzle should handle the JS object to JSON string conversion automatically.
      const testsToInsert = allTestsPg.map(t => ({
        ...t,
        // Ensure timestamps are in a compatible format (ISO string)
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
      }));
      await dbSqlite.insert(schemaSqlite.tests).values(testsToInsert).onConflictDoNothing();
      console.log('Tests migration completed.');
    }

    // --- Migrate Test Runs ---
    console.log('Fetching test runs from NeonDB...');
    const allTestRunsPg = await dbNeon.select().from(testRunsPg);
    console.log(`Fetched ${allTestRunsPg.length} test runs.`);
    if (allTestRunsPg.length > 0) {
      console.log('Inserting test runs into SQLite DB...');
      // results is jsonb in PG, text({mode: 'json'}) in SQLite
      const testRunsToInsert = allTestRunsPg.map(tr => ({
        ...tr,
        // Ensure timestamps are in a compatible format (ISO string)
        startedAt: tr.startedAt instanceof Date ? tr.startedAt.toISOString() : tr.startedAt,
        completedAt: tr.completedAt && tr.completedAt instanceof Date ? tr.completedAt.toISOString() : tr.completedAt,
      }));
      await dbSqlite.insert(schemaSqlite.testRuns).values(testRunsToInsert).onConflictDoNothing();
      console.log('Test runs migration completed.');
    }

    console.log('Data migration finished successfully!');

  } catch (error) {
    console.error('Error during data migration:', error);
    throw error; // Rethrow to indicate failure
  } finally {
    // Drizzle/neon-serverless might not require explicit pool ending in a script like this,
    // but good practice for other drivers.
    // For better-sqlite3, there's no explicit 'end' for the connection like a pool.
    // The process will exit and close the file handle.
    console.log('Migration process complete. Ensure to close any pending connections if applicable.');
    await pool.end(); // End NeonDB pool connection
    sqlite.close(); // Close SQLite connection
  }
}

migrateData().catch(err => {
  console.error("Migration script failed:", err);
  process.exit(1);
});
