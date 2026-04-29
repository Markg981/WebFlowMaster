import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set.');
}

const dbUrl = process.env.DATABASE_URL;

let db: any;

if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
  // Real PostgreSQL
  const pool = new Pool({ connectionString: dbUrl });
  db = drizzlePg(pool, { schema });
} else {
  // PGlite (local file/memory)
  const client = new PGlite(dbUrl);
  db = drizzlePglite(client, { schema });
}

export { db };