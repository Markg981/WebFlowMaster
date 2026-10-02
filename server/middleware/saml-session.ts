import type { Request, Response, NextFunction } from 'express';
import { isSamlSessionActive } from '../sso-saml';

/** The registry is authoritative even if deleting the backing Redis session failed. */
export async function requireActiveSamlSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.session?.samlIdentity || !req.user) return next();
  try {
    if (await isSamlSessionActive(req.sessionID, req.user.id, req.user.organizationId)) return next();
    req.logout(error => error ? next(error) : next());
  } catch (error) { next(error); }
}
