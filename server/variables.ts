import { and, eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { secrets as secretsTable } from '@shared/schema';
import { decryptSecret } from './crypto';
import loggerPromise from './logger';

/**
 * The one place `{{name}}` values come from.
 *
 * There used to be two. `outbound-http.requestVariables()` returned a single `baseUrl` read
 * from a process env var, and served the ad-hoc preview and single-test runs;
 * `test-execution-service.interpolateSecrets()` read the encrypted `secrets` table, and
 * served test plans. The same test therefore resolved differently depending on which button
 * started it — most visibly for a recorded password, which the recorder deliberately stores
 * as a `{{secret_…}}` placeholder and which only one of the two paths could resolve.
 *
 * `baseUrl` keeps its env-var default so existing installations behave as before, but an
 * environment can now override it like any other variable. That deliberately needs no new
 * column: a per-environment `baseUrl` is exactly a named value scoped to an environment,
 * which is what the secrets table already is.
 */

const DEFAULT_BASE_URL = 'http://localhost:7000';

export interface VariableScope {
  userId: number;
  organizationId: number;
  /** The environment whose values apply. Without one, only the defaults resolve. */
  environmentId?: number | null;
}

/** The values that resolve with no environment selected. */
export function defaultVariables(): Record<string, string> {
  return { baseUrl: process.env.DMO_BASE_URL || DEFAULT_BASE_URL };
}

export async function resolveVariables(scope: VariableScope): Promise<Record<string, string>> {
  const vars = defaultVariables();
  if (!scope.environmentId) return vars;

  const logger = await loggerPromise;

  // Scoped by organization as well as environment: an environment id is caller-supplied,
  // and without the organization predicate one tenant could read another's secrets by
  // guessing an id.
  const rows = await privilegedDb
    .select()
    .from(secretsTable)
    .where(
      and(
        eq(secretsTable.environmentId, scope.environmentId),
        eq(secretsTable.organizationId, scope.organizationId),
      ),
    );

  for (const row of rows) {
    try {
      vars[row.keyName] = decryptSecret(row.encryptedValue, row.iv, row.authTag);
    } catch {
      // A secret encrypted under a previous ENCRYPTION_KEY cannot be recovered. Leave it
      // unresolved so the step reports a named missing variable rather than sending a
      // corrupted value to the system under test.
      logger.warn(
        `Failed to decrypt secret ${row.keyName} for environment ${scope.environmentId}`,
      );
    }
  }

  return vars;
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Names the `{{variables}}` a string still contains that the given set cannot resolve.
 *
 * Substitution deliberately leaves an unknown name in place rather than blanking it, so a
 * typo shows up as an obviously wrong value. This turns that into something a caller can
 * report: which names are missing, so the message can say what to define instead of
 * letting a literal `{{secret_password}}` reach a login form.
 */
export function findUnresolvedVariables(
  value: string,
  vars: Record<string, string>,
): string[] {
  const missing = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!(match[1] in vars)) missing.add(match[1]);
  }
  return [...missing];
}
