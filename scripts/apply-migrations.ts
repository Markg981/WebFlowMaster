import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { db } from '../server/db'; // Reuses the driver selection logic (Postgres vs PGlite)
import * as path from 'path';

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
  try {
    console.log('Starting schema migrations...');
    if (isPostgres) {
      await migratePg(db as any, { migrationsFolder });
    } else {
      await migratePglite(db as any, { migrationsFolder });
    }
    console.log('Schema migrations applied successfully!');
  } catch (error) {
    console.error('Error applying schema migrations:', error);
    process.exit(1); // Exit with error
  }
}

runMigrations();
