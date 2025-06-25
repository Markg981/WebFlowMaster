import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set and point to the SQLite database file path.',
  );
}

const dbUrl = process.env.DATABASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../migrations');

console.log(`Connecting to SQLite database at: ${dbUrl}`);
const sqlite = new Database(dbUrl);
// We don't need the full schema here for migrations, just the db connection
const db = drizzle(sqlite);

console.log(`Looking for migrations in: ${migrationsFolder}`);

async function runMigrations() {
  try {
    console.log('Starting schema migrations...');
    await migrate(db, { migrationsFolder });
    console.log('Schema migrations applied successfully!');
  } catch (error) {
    console.error('Error applying schema migrations:', error);
    process.exit(1); // Exit with error
  } finally {
    sqlite.close(); // Close the database connection
    console.log('Database connection closed.');
  }
}

runMigrations();
