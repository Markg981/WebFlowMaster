import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';
import { privilegedDb } from '../db';

/** The Drizzle transaction handle, already scoped to one organization. */
export type TenantTx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];

interface TenantContext {
  organizationId: number;
}

/**
 * Same pattern as server/middleware/correlation.ts: one AsyncLocalStorage carrying
 * request-scoped state through the whole async chain, so nothing has to be threaded
 * through every function signature.
 */
const tenantStore = new AsyncLocalStorage<TenantContext>();

export function getTenantOrgId(): number | undefined {
  return tenantStore.getStore()?.organizationId;
}

/** Runs `fn` with the given organization as the ambient tenant. Used by tests and jobs. */
export function runWithTenant<T>(organizationId: number, fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve(tenantStore.run({ organizationId }, fn));
}

export function tenancyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const organizationId = (req.user as { organizationId?: number } | undefined)?.organizationId;
  if (organizationId === undefined) {
    // Unauthenticated or pre-org routes (login, health) simply have no tenant; the
    // request proceeds and any tenant query inside it will refuse to run.
    return next();
  }
  tenantStore.run({ organizationId }, () => next());
}

/**
 * Opens a transaction bound to the ambient organization.
 *
 * All three statements below are load-bearing:
 *  - SET LOCAL ROLE, because RLS is silently inert under a superuser: with ENABLE, FORCE
 *    and a correct policy in place, a superuser still sees every row and can UPDATE across
 *    organizations. There is no error and no warning.
 *  - LOCAL, because db.ts uses a connection pool. A non-local SET outlives the request and
 *    the next request on that connection inherits this organization.
 *  - set_config with a bound parameter rather than an interpolated SET, because the value
 *    would otherwise be an injection surface. Bound, a hostile value is rejected by the
 *    integer cast in the policy instead of executed.
 */
export async function withTenantTransaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const organizationId = getTenantOrgId();
  if (organizationId === undefined) {
    throw new Error(
      'withTenantTransaction called with no tenant context. Wrap the call in runWithTenant, ' +
        'or ensure tenancyMiddleware ran for this request.',
    );
  }

  return privilegedDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.current_org', ${String(organizationId)}, true)`);
    return fn(tx as TenantTx);
  });
}
