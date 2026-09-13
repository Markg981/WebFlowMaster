/**
 * Process-level configuration read from the environment.
 *
 * Separate from index.ts so it can be tested: index.ts is a top-level async IIFE that boots
 * the whole server on import, which makes anything inside it unreachable from a unit test.
 */

/** The port every existing deployment and the Vite dev proxy assume when PORT is unset. */
export const DEFAULT_PORT = 5000;

/**
 * The port to listen on.
 *
 * This used to be `const port = 5000` under a comment saying port 5000 was "the only port
 * that is not firewalled" — true of Replit, where the project started, and false of every
 * host it runs on now. PORT was read by nothing, so two instances could not share a host
 * and a reverse proxy had to be bent around the app instead of configured.
 *
 * A malformed value throws rather than falling back. Binding 5000 while the operator
 * believes they asked for something else produces one symptom — a proxy pointing at
 * nothing — and no clue as to why.
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT?.trim();
  // `PORT=` in a .env file arrives as an empty string, not as undefined.
  if (!raw) return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535; got "${env.PORT}". ` +
        `Leave it unset to use the default of ${DEFAULT_PORT}.`,
    );
  }
  return port;
}

/**
 * Whether the session cookie is marked `Secure`, and so only sent over HTTPS.
 *
 * On in production, because a session cookie travelling in plaintext is a session anyone on
 * the path can take. But it used to be *only* that, with no way to say otherwise — and the
 * consequence was that the shipped docker-compose stack, which serves plain HTTP on
 * localhost, could not be logged into at all: the browser drops the cookie, `/api/login`
 * answers 200, and every request after it is anonymous with nothing anywhere saying why.
 *
 * `SESSION_COOKIE_SECURE` makes that a decision rather than an accident. A value that is
 * neither "true" nor "false" is ignored: guessing is worse than the default in both
 * directions — reading "yes" as false would quietly expose the cookie, and reading it as
 * true would quietly break every login.
 */
export function sessionCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return env.NODE_ENV === 'production';
}
