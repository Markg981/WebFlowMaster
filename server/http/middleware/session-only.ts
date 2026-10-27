import type { Request, Response, NextFunction } from 'express';

/**
 * Rejects a request that authenticated with an API key (403, code `session_required`).
 *
 * For routes that mint credentials, change who belongs to the organization or at what role, or
 * touch org-wide security settings: a leaked key must not be able to widen its own reach or get
 * around SSO/MFA enforcement (audit A-06). Place it after `requireRole`.
 */
export function sessionOnly(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req as Request & { apiKeyId?: string }).apiKeyId) {
      return res.status(403).json({
        error: `${action} must be done from a signed-in session, not with an API key.`,
        code: 'session_required',
      });
    }
    next();
  };
}
