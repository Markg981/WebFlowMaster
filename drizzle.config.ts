import { defineConfig } from "drizzle-kit";

if (!process.env.SQLITE_DATABASE_URL) {
  // Updated to suggest SQLITE_DATABASE_URL or a default path
  console.warn(
    "SQLITE_DATABASE_URL not set, defaulting to 'data/local.db' for drizzle-kit. Ensure this is intended or set the variable.",
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    // Use SQLITE_DATABASE_URL, or a default if not set.
    // The application itself (in server/db.ts) will strictly require DATABASE_URL,
    // which we will later set to the SQLite path.
    // For drizzle-kit, we can use a specific variable or a default.
    url: process.env.SQLITE_DATABASE_URL || "data/local.db",
  },
});
