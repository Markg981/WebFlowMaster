import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Gives every test file its own database.
 *
 * Vitest runs setup files before the test file's own module graph is loaded, and with
 * `isolate: true` (the default) each file gets a fresh module registry. So assigning
 * DATABASE_URL here, before `../db` is ever imported, means each file's `privilegedDb`
 * singleton binds to a PGlite instance nothing else can see.
 *
 * The alternative — one file-backed database shared by every suite — is what this replaces,
 * and it cost far more than the migrations below. PGlite is a single-writer WASM instance, so
 * a shared database forced `singleFork` and `fileParallelism: false`: every suite ran
 * sequentially in one process, and rows one file forgot to clean up failed a *different* file.
 * That happened repeatedly and the failures pointed at the innocent file, not the guilty one.
 * A per-file database makes cross-file interference impossible rather than merely discouraged.
 *
 * `memory://` is deliberate: an in-memory instance needs no temp directory to create or clean
 * up, and there is nothing left behind for the next run to inherit.
 */

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

// A run against a real Postgres (the CI job that exercises RLS as a non-superuser) keeps the
// database it was given: there is one server, migrations are applied once, and suites share it
// the way they always did. Only the PGlite path gets an instance per file.
const givenUrl = process.env.DATABASE_URL ?? '';
const isPostgres = givenUrl.startsWith('postgres://') || givenUrl.startsWith('postgresql://');

if (!isDirectRun && !isPostgres) {
  process.env.DATABASE_URL = 'memory://';
}

async function applyMigrations() {
  // Imported dynamically, and only after DATABASE_URL is settled above: a static import would
  // bind server/db.ts's singleton to whatever the variable held at module-evaluation time,
  // which is the shared file database this setup exists to stop using.
  const { privilegedDb } = await import('../db');

  const migrationsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

  if (isPostgres) {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(privilegedDb as never, { migrationsFolder: migrationsPath });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(privilegedDb as never, { migrationsFolder: migrationsPath });
  }
}

await applyMigrations();

// Only when run as a script (npm run test:setup-db, and the CI job that migrates a real
// Postgres once before the suite). Exiting while running as a Vitest setup file would kill the
// runner; PGlite's WASM handles can otherwise leave a non-zero exit on Windows.
if (isDirectRun) {
  process.exit(0);
}
