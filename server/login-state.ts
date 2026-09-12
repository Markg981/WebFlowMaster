import { and, eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { environments } from '@shared/schema';
import { decryptSecret, encryptSecret } from './crypto';
import loggerPromise from './logger';

/**
 * A browser session saved against an environment, so a test can start already
 * authenticated.
 *
 * Nothing reused a session before this: no `storageState`, no saved cookies, no
 * `httpCredentials`. Every test logged in through the interface first, which on DMO — a
 * factory site behind an authenticated Angular shell — was most of the cost of most tests,
 * and the most common reason a test failed for something other than what it checked.
 *
 * Stored encrypted with the same AES-256-GCM scheme as `secrets`, because the payload is
 * cookies and session tokens: credentials for the system under test, not configuration.
 */

/** Playwright's `storageState` shape. Kept loose: it is the driver's contract, not ours. */
export interface LoginState {
  cookies: unknown[];
  origins: unknown[];
}

export interface EnvironmentScope {
  environmentId: number;
  /** From the session, never from a request body — it is what bounds the lookup. */
  organizationId: number;
}

export async function saveLoginState(
  scope: EnvironmentScope,
  state: LoginState,
): Promise<void> {
  const { encryptedValue, iv, authTag } = encryptSecret(JSON.stringify(state));

  await privilegedDb
    .update(environments)
    .set({
      loginState: encryptedValue,
      loginStateIv: iv,
      loginStateAuthTag: authTag,
      loginStateCapturedAt: new Date(),
    })
    .where(
      and(
        eq(environments.id, scope.environmentId),
        // Both predicates, always: an environment id reaches this from a request, and
        // without the organization one a caller could write into another tenant's row.
        eq(environments.organizationId, scope.organizationId),
      ),
    );
}

/** The saved session for this environment, or undefined when there is none to reuse. */
export async function loadLoginState(
  scope: EnvironmentScope,
): Promise<LoginState | undefined> {
  const [row] = await privilegedDb
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.id, scope.environmentId),
        eq(environments.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  if (!row?.loginState || !row.loginStateIv || !row.loginStateAuthTag) return undefined;

  try {
    return JSON.parse(decryptSecret(row.loginState, row.loginStateIv, row.loginStateAuthTag));
  } catch {
    // A state encrypted under a previous ENCRYPTION_KEY, or a truncated row. Running
    // unauthenticated is the honest outcome: the test then fails on its first
    // authenticated step, which is a far clearer signal than a corrupted cookie jar.
    const logger = await loggerPromise;
    logger.warn(
      `Could not read the saved login state for environment ${scope.environmentId}; ` +
        'the run will start unauthenticated.',
    );
    return undefined;
  }
}

/** Forgets the saved session — for a logout, or a state known to have expired. */
export async function clearLoginState(scope: EnvironmentScope): Promise<void> {
  await privilegedDb
    .update(environments)
    .set({
      loginState: null,
      loginStateIv: null,
      loginStateAuthTag: null,
      loginStateCapturedAt: null,
    })
    .where(
      and(
        eq(environments.id, scope.environmentId),
        eq(environments.organizationId, scope.organizationId),
      ),
    );
}
