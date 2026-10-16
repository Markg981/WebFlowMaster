/**
 * What a script may say about the database it is about to use: the driver, and nothing else.
 *
 * `DATABASE_URL` is a connection string, and a connection string carries the password. The
 * migration script used to print it whole ("Connecting to database at: postgres://app:…@db/…"),
 * which put the database password into every deployment log, CI log and terminal scrollback that
 * ran a migration. The host and the database name are left out too: they are not secret, but nothing
 * here needs them, and a URL that is only partly printed is one parser bug away from a full one.
 */
export function describeDatabaseTarget(url: string | undefined): string {
  if (!url) return 'no database configured';
  if (/^postgres(ql)?:\/\//i.test(url)) return 'PostgreSQL';
  if (url.startsWith('memory://')) return 'PGlite (in memory)';
  return 'PGlite (local data directory)';
}
