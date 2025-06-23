import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db'; // Adjust path as necessary
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

    await migrate(db, { migrationsFolder: migrationsPath });
    console.log('Test database migrations completed successfully.');
  } catch (error) {
    console.error('Failed to apply migrations for test database:', error);
    process.exit(1); // Exit if migrations fail, as tests will likely be incorrect
  }
}

// Call globalSetup directly when the script is executed.
globalSetup().catch(error => {
  console.error("Error during test database setup:", error);
  process.exit(1);
});
