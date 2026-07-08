import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { db } from '../db'; // Reuses the driver selection logic (Postgres vs PGlite)
import path from 'path';
import { fileURLToPath } from 'url'; // Added for ES Module equivalent of __dirname

// This setup will run once before all test suites.
async function globalSetup() {
  console.log('Running test database migrations...');
  try {
    // Ensure DATABASE_URL is set for the test environment, Vitest config should handle this.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set for test environment in setup file.');
    }
    console.log(`Test DATABASE_URL: ${process.env.DATABASE_URL}`);

    // ES Module equivalent for __dirname
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Drizzle expects the migrations folder path relative to the execution context,
    // or an absolute path. Let's use an absolute path for robustness.
    const migrationsPath = path.resolve(__dirname, '../../migrations');
    console.log(`Resolved migrations path: ${migrationsPath}`);

    // Pick the migrator that matches the driver selected in db.ts.
    const dbUrl = process.env.DATABASE_URL;
    const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');
    if (isPostgres) {
      await migratePg(db as any, { migrationsFolder: migrationsPath });
    } else {
      await migratePglite(db as any, { migrationsFolder: migrationsPath });
    }
    console.log('Test database migrations completed successfully.');
  } catch (error) {
    console.error('Failed to apply migrations for test database:', error);
    process.exit(1); // Exit if migrations fail, as tests will likely be incorrect
  }
}

// Detect whether this file is being executed directly (npm run test:setup-db)
// versus imported by Vitest as a setupFile. We only force-exit in the direct case:
// exiting the process while running as a Vitest setupFile would kill the test runner.
const runDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

// Call globalSetup directly when the script is executed.
globalSetup()
  .then(() => {
    // Exit explicitly so the process terminates cleanly even if the DB driver
    // keeps handles open (PGlite/WASM can otherwise leave a non-zero exit on Windows).
    if (runDirectly) process.exit(0);
  })
  .catch(error => {
    console.error("Error during test database setup:", error);
    process.exit(1);
  });
