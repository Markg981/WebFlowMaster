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
