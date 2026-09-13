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
