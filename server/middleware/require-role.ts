import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type Role = 'viewer' | 'editor' | 'owner';

/**
 * Ascending capability. RLS (server/middleware/tenancy.ts) decides which rows a request may
 * touch; this decides which verbs it may use on them. The two never interact: a viewer and an
 * owner in the same organization see exactly the same rows.
 */
const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

function isRole(value: string): value is Role {
  return value in RANK;
}

/**
 * Requires the session user to hold at least `minimum` role, ascending viewer < editor < owner.
 *
 * Unauthenticated requests get 401, not 403: "no session" and "wrong permissions" are different
 * failures, and collapsing them into one status would make a client unable to tell "log in" from
 * "you can't do that". A recognised-but-insufficient role, and any role string this code does not
 * recognise (a hand-edited row, or a role added to the database before this code knows about it),
 * both get 403 and are refused identically — an unknown role is never treated as sufficient.
 *
 * A role failure on a row the caller's own organization owns still answers 403, not 404: unlike
 * cross-tenant lookups (see server/routes/uploads.routes.ts), the caller already knows the row
 * exists and who owns it, so a 403 here reveals nothing a same-organization member doesn't
 * already have.
 */
export function requireRole(minimum: Role): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { role } = req.user;
    if (!isRole(role) || RANK[role] < RANK[minimum]) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}
