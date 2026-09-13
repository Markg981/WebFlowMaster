import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { privilegedDb } from '../server/db'; // Reuses the driver selection logic (Postgres vs PGlite)
import * as path from 'path';
import { inspectSchemaState, describeSchemaState } from '../server/schema-state';

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set and point to the database (Postgres connection string or PGlite data path).',
  );
}

const dbUrl = process.env.DATABASE_URL;
const migrationsFolder = path.resolve(process.cwd(), 'migrations');
const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

console.log(`Connecting to database at: ${dbUrl} (${isPostgres ? 'PostgreSQL' : 'PGlite'})`);
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
    console.error('Error applying schema migrations:', error);
    process.exit(1); // Exit with error
  }
}

runMigrations();
