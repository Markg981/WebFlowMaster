import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@shared/schema';
import fs from 'fs';
import path from 'path';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set.');
}

const dbUrl = process.env.DATABASE_URL;

export type DbType = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;
let db: DbType;

let closeDbImpl: () => Promise<void> = async () => {};

if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
  // Real PostgreSQL
  const pool = new Pool({ connectionString: dbUrl });
  db = drizzlePg(pool, { schema });
  closeDbImpl = () => pool.end();
} else {
  // PGlite (local file/memory). For a file-backed data dir, ensure the parent exists —
  // PGlite does not create it recursively, so a fresh checkout (e.g. CI) fails otherwise.
  if (!dbUrl.startsWith('memory://')) {
    fs.mkdirSync(path.dirname(dbUrl), { recursive: true });
  }
  const client = new PGlite(dbUrl);
  db = drizzlePglite(client, { schema });
  closeDbImpl = () => client.close();
}

/** Close the underlying DB connection(s). Used during graceful shutdown. */
export async function closeDb(): Promise<void> {
  await closeDbImpl();
}

export { db };