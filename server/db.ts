import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@shared/schema';
import fs from 'fs';
import path from 'path';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set and point to the SQLite database file path.',
  );
}

const dbPath = process.env.DATABASE_URL;
const dbDir = path.dirname(dbPath);

// Ensure the directory for the SQLite database exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// DATABASE_URL will be the path to the SQLite file, e.g., "data/local.db"
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

// We are no longer exporting 'pool' as it's specific to NeonDB