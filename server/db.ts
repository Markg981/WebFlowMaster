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

/**
 * The privileged handle. It BYPASSES row-level security, so it is correct only for
 * migrations, bootstrap and tests. Application code must go through
 * withTenantTransaction in server/middleware/tenancy.ts instead — an architecture test
 * (server/tests/architecture.test.ts) fails if a route imports this.
 */
export { db as privilegedDb };

/**
 * Refuses to boot if the database is not configured the way the tenancy design requires.
 *
 * Three things have to be true, and none of them can be checked by the test suite: PGlite
 * connects as `postgres`, a superuser, for whom all three hold trivially. That is the same
 * blind spot that makes row-level security silently inert under a superuser — it does not
 * error, it just stops isolating — so the check has to happen against the real database, at
 * startup, rather than being discovered on the first request in production.
 *
 * 1. `app_user` exists. Without it `SET LOCAL ROLE app_user` fails and every tenant-scoped
 *    query fails with it.
 * 2. The connection role may SET ROLE to it. SET ROLE needs membership or superuser; migration
 *    0005 grants the membership, but a database restored from a dump, or provisioned by hand,
 *    may not have it.
 * 3. The connection role can bypass RLS, and `app_user` cannot. FORCE ROW LEVEL SECURITY
 *    subjects the table *owner* to the policies, so on a real deployment the role that owns
 *    the tables is filtered like anyone else unless it holds BYPASSRLS — which would break the
 *    deliberate privileged bootstraps (the queue worker learning a job's organization,
 *    emitExecutionLog, the audit entry written as an invitation is accepted). BYPASSRLS cannot
 *    be granted by a migration, since granting it needs superuser: it is a deployment
 *    prerequisite, and this is where a missing one is caught.
 *
 * Skipped for PGlite, where none of it is meaningful.
 */
export async function assertTenancyPreconditions(): Promise<void> {
  const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');
  if (!isPostgres) return;

  const { sql } = await import('drizzle-orm');
  const result = await db.execute(sql`
    SELECT
      current_user::text                                                       AS connection_role,
      (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user)        AS connection_is_superuser,
      (SELECT rolbypassrls  FROM pg_roles WHERE rolname = current_user)        AS connection_bypasses_rls,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')               AS app_user_exists,
      (SELECT rolbypassrls  FROM pg_roles WHERE rolname = 'app_user')          AS app_user_bypasses_rls,
      pg_has_role(current_user, 'app_user', 'MEMBER')                          AS can_set_role
  `);

  const row = result.rows[0] as {
    connection_role: string;
    connection_is_superuser: boolean;
    connection_bypasses_rls: boolean;
    app_user_exists: boolean;
    app_user_bypasses_rls: boolean | null;
    can_set_role: boolean;
  };

  const problems: string[] = [];

  if (!row.app_user_exists) {
    problems.push("the 'app_user' role does not exist — run the migrations");
  } else {
    if (!row.can_set_role) {
      problems.push(
        `'${row.connection_role}' is not a member of 'app_user', so SET ROLE will fail on every ` +
          "tenant-scoped query — GRANT app_user TO " + row.connection_role,
      );
    }
    if (row.app_user_bypasses_rls) {
      problems.push(
        "'app_user' has BYPASSRLS, which makes row-level security inert — " +
          'ALTER ROLE app_user NOBYPASSRLS',
      );
    }
  }

  if (!row.connection_is_superuser && !row.connection_bypasses_rls) {
    problems.push(
      `'${row.connection_role}' can neither bypass RLS nor is a superuser. If it owns the ` +
        'tables, FORCE ROW LEVEL SECURITY applies to it too and the privileged bootstrap paths ' +
        `will silently read and write nothing — ALTER ROLE ${row.connection_role} BYPASSRLS ` +
        '(requires a superuser)',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      'Refusing to start: the database is not configured for tenant isolation.\n  - ' +
        problems.join('\n  - '),
    );
  }
}
