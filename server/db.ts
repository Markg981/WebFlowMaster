import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set and point to the SQLite database file path.',
  );
}

// DATABASE_URL will be the path to the SQLite file, e.g., "data/local.db"
const sqlite = new Database(process.env.DATABASE_URL);
export const db = drizzle(sqlite, { schema });

// We are no longer exporting 'pool' as it's specific to NeonDB