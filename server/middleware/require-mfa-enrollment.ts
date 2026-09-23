import type { Request, Response, NextFunction } from 'express';
import { mustEnrol } from '../mfa';

/**
 * Where an organization requires a second factor, a member without one can do nothing but set
 * it up.
 *
 * Checked on every request of a signed-in session rather than once at sign-in, so switching the
 * policy on takes effect for sessions already open, not only for the next sign-in. Requests made
 * with an API key are not affected: a key is already something the caller has.
 */

/** What a member who must enrol can still reach: who they are, the way out, and enrolment. */
const ALLOWED = [/^\/api\/user$/, /^\/api\/logout$/, /^\/api\/mfa(\/|$)/];

export async function requireMfaEnrollment(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/')) return next();
  if (!req.isAuthenticated?.() || !req.user) return next();
  if ((req as Request & { apiKeyId?: string }).apiKeyId) return next();
  if (ALLOWED.some((pattern) => pattern.test(req.path))) return next();

  try {
    if (await mustEnrol(req.user.id, req.user.organizationId)) {
      return res.status(403).json({
        error: 'Your organization requires two-factor authentication. Set it up to continue.',
        code: 'mfa_enrollment_required',
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}
