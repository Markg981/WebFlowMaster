import type { Request, Response, NextFunction } from 'express';
import { ssoRequiredFor } from '../sso';

/**
 * Where an organization requires single sign-on, a session opened with a password ends.
 *
 * Checked on every request rather than only at sign-in, like the second-factor requirement, so
 * turning it on takes effect for sessions already open: otherwise a password somebody should no
 * longer have would keep working for the week a session lasts. Owners are exempt (they are the
 * way back in when the provider fails), and so are API keys, which are not a password.
 */
export async function requireSso(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/')) return next();
  if (!req.isAuthenticated?.() || !req.user) return next();
  if ((req as Request & { apiKeyId?: string }).apiKeyId) return next();
  if (req.session?.signedInWith === 'sso') return next();

  try {
    if (!(await ssoRequiredFor(req.user))) return next();
    req.logout((error) => {
      if (error) return next(error);
      res.status(401).json({
        error: 'Your organization signs in with single sign-on. Sign in again with "Sign in with SSO".',
        code: 'sso_required',
      });
    });
  } catch (error) {
    next(error);
  }
}
