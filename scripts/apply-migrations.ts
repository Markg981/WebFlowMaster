import './migrator-env'; // Before server/db: no statement timeout while migrating.
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { privilegedDb } from '../server/platform/db'; // Reuses the driver selection logic (Postgres vs PGlite)
import * as path from 'path';
import { inspectSchemaState, describeSchemaState } from '../server/platform/schema-state';
import { describeDatabaseTarget } from './database-target';

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set and point to the database (Postgres connection string or PGlite data path).',
  );
}

const dbUrl = process.env.DATABASE_URL;
const migrationsFolder = path.resolve(process.cwd(), 'migrations');
const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

// The driver only: the connection string carries the password (scripts/database-target.ts).
console.log(`Connecting to the database (${describeDatabaseTarget(dbUrl)})`);
console.log(`Looking for migrations in: ${migrationsFolder}`);

async function runMigrations() {
  // Diagnose before attempting anything. A database whose schema was created outside the
  // migration system fails on the first table it finds already present, reporting
  // `relation "api_test_history" already exists` — which names a symptom, offers no cause,
  // and sent people looking for a problem in the migration rather than in how the database
  // was built. Say what happened and what to do instead.
  const state = await inspectSchemaState();
  if (state.kind === 'unmanaged') {
    console.error(describeSchemaState(state));
    process.exit(1);
  }

  if (state.kind === 'ready') {
    console.log(describeSchemaState(state));
    return;
  }

  try {
    console.log('Starting schema migrations...');
    if (isPostgres) {
      await migratePg(privilegedDb as any, { migrationsFolder });
    } else {
      await migratePglite(privilegedDb as any, { migrationsFolder });
    }
    console.log('Schema migrations applied successfully!');
  } catch (error) {
    // The message, not the object: a driver error can carry the connection settings it was given.
    console.error('Error applying schema migrations:', (error as Error)?.message ?? String(error));
    process.exit(1); // Exit with error
  }
}

// The schema inspection runs outside the try above; an unhandled rejection would print the whole
// error object, and with it whatever the driver attached.
runMigrations().catch((error) => {
  console.error('Could not reach the database:', (error as Error)?.message ?? String(error));
  process.exit(1);
});
