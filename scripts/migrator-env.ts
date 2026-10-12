// Imported first by apply-migrations.ts, so it runs before server/platform/db.ts reads the environment.
// A migration may rebuild an index or rewrite a large table, which takes as long as it takes:
// the statement timeout that protects the application's pool would abort it halfway. An explicit
// PG_STATEMENT_TIMEOUT_MS still wins.
process.env.PG_STATEMENT_TIMEOUT_MS ??= '0';
