import { resolvePort } from './config';
import { registrationMode } from './registration';
import { cspMode } from './security-headers';

/**
 * Every environment setting that can be wrong without touching the network, checked before
 * anything does.
 *
 * Each of these already threw on a bad value, but from wherever it was first read — setupAuth,
 * securityHeaders, the listen call — and the start reaches those only after PostgreSQL and
 * Redis have answered. With either of them down, or not yet up, the operator saw
 * ECONNREFUSED and never the misspelt variable that would have stopped the start anyway.
 * All problems are reported at once, so fixing one does not just reveal the next.
 */
export function startupConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];
  if (!env.SESSION_SECRET) errors.push('SESSION_SECRET must be set for session security.');
  for (const check of [() => registrationMode(env), () => cspMode(env), () => resolvePort(env)]) {
    try {
      check();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

export function assertStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors = startupConfigErrors(env);
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Connects the session store's Redis before the first request. In production a failure stops
 * the start with the reason Redis gave: the shared store is mandatory there (several web
 * processes and the worker read the same sessions), and the message "logins will not persist"
 * that the start used to log hid the cause behind the generic refusal createSessionStore()
 * raised a moment later. Elsewhere the in-memory store is a local convenience, so it only warns.
 */
export async function connectSessionStore(
  connect: () => Promise<void>,
  warn: (message: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    await connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (env.NODE_ENV === 'production') {
      throw new Error(`Session Redis is not reachable (${reason}). Production needs the shared session store: check REDIS_URL and that Redis is up.`);
    }
    warn(`Session Redis is not reachable (${reason}); using an in-memory session store: logins will not survive a restart.`);
  }
}
