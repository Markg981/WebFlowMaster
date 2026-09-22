import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { apiKeys, users } from '@shared/schema';
import { privilegedDb } from '../db';
import { apiKeyFromRequest, hashApiKey, hashesMatch, rejectionFor } from '../api-keys';
import loggerPromise from '../logger';

/**
 * Letting a request authenticate as a key instead of as a session.
 *
 * This runs between passport and `tenancyMiddleware`, and does exactly one thing: when a
 * request carries a key and no session, it puts the key's user on the request. Everything
 * downstream — `tenancyMiddleware`, which reads `req.user.organizationId`, `requireRole`,
 * which reads `req.user.role`, and every handler — then works unchanged, because from their
 * point of view nothing happened differently. Adding a second authorisation model for
 * machines would have meant auditing every route twice.
 *
 * The lookup is privileged, and has to be: it is the query that answers "which organization
 * is this request for?", so it cannot itself run inside an organization. It is the same
 * bootstrap shape as passport's deserializeUser, and it is the only privileged statement
 * here — one read, plus a fire-and-forget touch of `last_used_at`.
 */

/**
 * How stale `last_used_at` is allowed to be.
 *
 * A pipeline can make hundreds of calls in a minute and the column exists to answer "is this
 * key still in use?", a question no one asks to the second. Writing on every request would
 * add a write to every read.
 */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/** Keys touched recently, so a burst of requests does not become a burst of updates. */
const recentlyTouched = new Map<string, number>();

export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // A session wins. Someone testing an API key from a logged-in browser tab should not have
  // their own session silently replaced by whatever key was pasted into a header.
  if (req.isAuthenticated?.() && req.user) return next();

  const presented = apiKeyFromRequest(req.headers as Record<string, string | string[] | undefined>);
  if (!presented) return next();

  const logger = await loggerPromise;
  try {
    const hashed = hashApiKey(presented);
    const rows = await privilegedDb
      .select({
        id: apiKeys.id,
        organizationId: apiKeys.organizationId,
        userId: apiKeys.userId,
        hashedKey: apiKeys.hashedKey,
        revokedAt: apiKeys.revokedAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.hashedKey, hashed))
      .limit(1);

    const row = rows[0];
    // The lookup is by hash and therefore already exact; the constant-time compare is here so
    // that a future change to how rows are found cannot quietly make the match leaky.
    const matched = row && hashesMatch(row.hashedKey, hashed) ? row : undefined;
    const rejection = rejectionFor(matched);
    if (rejection) {
      // Deliberately not refused here. An unusable key leaves the request exactly as
      // unauthenticated as it arrived, and the route's own `requireRole` answers 401 — so a
      // revoked key and no key at all are indistinguishable from outside, and this middleware
      // never becomes a way to ask whether a key exists.
      logger.warn({ message: 'API key refused', reason: rejection, path: req.path });
      return next();
    }

    const [user] = await privilegedDb.select().from(users).where(eq(users.id, matched!.userId)).limit(1);
    if (!user) {
      logger.warn({ message: 'API key names a user that no longer exists', apiKeyId: matched!.id });
      return next();
    }
    if (user.organizationId !== matched!.organizationId) {
      // The key was issued inside one organization and its user now belongs to another. The
      // key does not follow them: it was granted by an organization, not by a person.
      logger.warn({
        message: 'API key organization no longer matches its user; refusing',
        apiKeyId: matched!.id,
      });
      return next();
    }

    req.user = user;
    // Everything downstream asks passport this question, including requireRole.
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    // Marks the request for anything that wants to distinguish a pipeline from a person —
    // the audit trail, rate limiting, and logs read at three in the morning.
    (req as Request & { apiKeyId?: string }).apiKeyId = matched!.id;

    touchLastUsed(matched!.id).catch(() => {
      /* recorded below; never worth failing a request over */
    });
    return next();
  } catch (error: any) {
    logger.error({ message: 'API key authentication failed', error: error?.message ?? String(error) });
    return next();
  }
}

async function touchLastUsed(apiKeyId: string): Promise<void> {
  const now = Date.now();
  const last = recentlyTouched.get(apiKeyId);
  if (last !== undefined && now - last < LAST_USED_WRITE_INTERVAL_MS) return;
  recentlyTouched.set(apiKeyId, now);
  await privilegedDb.update(apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(apiKeys.id, apiKeyId));
}

/** Test seam: the throttle is process-wide state, and a test must not inherit another's. */
export function resetApiKeyUsageThrottle(): void {
  recentlyTouched.clear();
}
