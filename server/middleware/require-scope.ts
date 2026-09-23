import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { API_SCOPES, type ApiScope } from '@shared/api-scopes';
import { roleAllows } from './require-role';
import type { KeyAuthenticatedRequest } from './api-key-auth';

/** The handler, carrying the scope it checks so the OpenAPI test can read it off the route. */
export type ScopeGuard = RequestHandler & { scope: ApiScope };

/** How every /api/v1 error looks: a stable code to branch on, and a sentence for a person. */
export function apiError(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

/**
 * Guards an /api/v1 endpoint: the caller's role must allow it, and a scoped key must hold the
 * scope.
 *
 * Both checks, always. The role is the ceiling — a scope on a viewer's key does not make it an
 * editor — and the scope narrows below it. A session, and a key from before scopes, carry no
 * scopes and are bounded by the role alone, exactly as on the rest of the application.
 *
 * This is the endpoint's role check (the architecture test on route files accepts it as one):
 * the minimum role comes from the scope, in shared/api-scopes.ts.
 */
export function requireScope(scope: ApiScope): ScopeGuard {
  const minimumRole = API_SCOPES[scope].minimumRole;

  const guard = ((req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated?.() || !req.user) {
      return apiError(res, 401, 'unauthenticated', 'Send an API key as "Authorization: Bearer <key>" or "X-API-Key".');
    }
    if (!roleAllows(req.user.role, minimumRole)) {
      return apiError(res, 403, 'insufficient_role', `This needs the ${minimumRole} role or higher.`, { requiredRole: minimumRole });
    }
    const scopes = (req as KeyAuthenticatedRequest).apiKeyScopes;
    if (scopes && !scopes.includes(scope)) {
      return apiError(res, 403, 'insufficient_scope', `This API key does not have the "${scope}" scope.`, { requiredScope: scope });
    }
    next();
  }) as ScopeGuard;
  guard.scope = scope;
  return guard;
}
