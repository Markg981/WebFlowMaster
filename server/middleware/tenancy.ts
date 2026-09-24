import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';
import { privilegedDb } from '../db';

/** The Drizzle transaction handle, already scoped to one organization. */
export type TenantTx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];

/**
 * Who is asking, inside the organization. Bound into each tenant transaction so row-level
 * security can narrow what a member sees to the projects they are on (migration 0031). Absent
 * for the system itself — the worker, a sweep — which sees the whole organization as before.
 */
export interface TenantPrincipal {
  userId: number;
  role: string;
}

interface TenantContext {
  organizationId: number;
  principal?: TenantPrincipal;
  /**
   * The transaction opened by the outermost withTenantTransaction call currently in scope,
   * if one is open. A nested withTenantTransaction call reuses it instead of opening a
   * second one — see that function's doc comment for why a second transaction is unsafe
   * under both drivers.
   */
  tx?: TenantTx;
}

/**
 * Thrown when runWithTenant is called for one organization while a transaction is already
 * open and bound to a different one. Silently proceeding would run the new call's work under
 * the wrong organization's SET LOCAL ROLE / app.current_org binding — exactly the kind of
 * silent cross-tenant leak this module exists to prevent — so this fails loudly instead.
 */
export class TenantConflictError extends Error {
  constructor(activeOrganizationId: number, requestedOrganizationId: number) {
    super(
      `runWithTenant(${requestedOrganizationId}) was called while a transaction was already ` +
        `open for organization ${activeOrganizationId}. A nested call cannot bind a different ` +
        'organization onto an already-open transaction.',
    );
    this.name = 'TenantConflictError';
  }
}

/**
 * Same pattern as server/middleware/correlation.ts: one AsyncLocalStorage carrying
 * request-scoped state through the whole async chain, so nothing has to be threaded
 * through every function signature.
 */
const tenantStore = new AsyncLocalStorage<TenantContext>();

/**
 * Runs `fn` for the organization itself rather than for whoever is asking: no principal, so the
 * project policies of migration 0031 do not narrow what it reads.
 *
 * For work whose result must not depend on who triggered it — creating a run of a plan is the
 * one: a plan is the organization's, and a run of it must contain the same tests whether a member
 * on every project or on none pressed Run. Refuses when a transaction bound to a user is already
 * open, because that binding cannot be undone from inside it.
 */
export async function runAsOrganization<T>(organizationId: number, fn: () => Promise<T> | T): Promise<T> {
  const store = tenantStore.getStore();
  if (store?.tx !== undefined) {
    if (store.organizationId !== organizationId) throw new TenantConflictError(store.organizationId, organizationId);
    if (store.principal) {
      throw new Error('runAsOrganization called inside a transaction already bound to a user; call it before opening one.');
    }
    return tenantStore.run({ organizationId, tx: store.tx }, fn);
  }
  return tenantStore.run({ organizationId }, fn);
}

/**
 * Runs `fn` for an organization in a context of its own: no principal, and not inside whatever
 * transaction the caller has open.
 *
 * For work another path starts and does not wait for — telling a GitHub a run moved — which must
 * neither join a transaction that will have committed by the time it runs, nor be refused for being
 * started inside one.
 */
export function runDetachedForOrganization<T>(organizationId: number, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ organizationId }, fn);
}

export function getTenantOrgId(): number | undefined {
  return tenantStore.getStore()?.organizationId;
}

/**
 * Runs `fn` with the given organization as the ambient tenant. Used by tests and jobs.
 *
 * With no principal, `fn` runs as the system. Inside a request for the same organization, the
 * request's principal is kept: a nested call never widens what the requester can see.
 */
export async function runWithTenant<T>(
  organizationId: number,
  fn: () => Promise<T> | T,
  principal?: TenantPrincipal,
): Promise<T> {
  const store = tenantStore.getStore();
  if (store?.tx !== undefined && store.organizationId !== organizationId) {
    throw new TenantConflictError(store.organizationId, organizationId);
  }
  const inherited = store?.organizationId === organizationId ? store.principal : undefined;
  const nextPrincipal = principal ?? inherited;
  // Carry the open transaction forward when the organization is unchanged, so a
  // withTenantTransaction call inside fn still finds it and joins it instead of reopening.
  const nextStore: TenantContext = {
    organizationId,
    ...(nextPrincipal ? { principal: nextPrincipal } : {}),
    ...(store?.tx !== undefined ? { tx: store.tx } : {}),
  };
  return tenantStore.run(nextStore, fn);
}

export function tenancyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const organizationId = req.user?.organizationId;
  if (organizationId === undefined) {
    // Unauthenticated or pre-org routes (login, health) simply have no tenant; the
    // request proceeds and any tenant query inside it will refuse to run.
    return next();
  }
  // The requester goes with the organization: RLS narrows what they see to their projects.
  const principal = req.user ? { userId: req.user.id, role: req.user.role } : undefined;
  tenantStore.run({ organizationId, ...(principal ? { principal } : {}) }, () => next());
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
  const store = tenantStore.getStore();
  const organizationId = store?.organizationId;
  if (organizationId === undefined) {
    throw new Error(
      'withTenantTransaction called with no tenant context. Wrap the call in runWithTenant, ' +
        'or ensure tenancyMiddleware ran for this request.',
    );
  }

  if (store?.tx !== undefined) {
    // Reentrant call: a transaction is already open for this exact organization (runWithTenant
    // throws a TenantConflictError before this point if a nested call tried to bind a
    // different one). Join it instead of opening a second one.
    //
    // A second transaction here is not merely wasteful, it is broken: under PGlite (dev/test)
    // drizzle-orm/pglite delegates to a client-wide single-writer mutex, so the inner call
    // deadlocks waiting on a lock the outer call holds, wedging the shared connection for
    // every later test too. Under node-postgres (production) the inner call instead takes a
    // second client from the pool, which both loses atomicity across the boundary (the two
    // transactions can commit/rollback independently) and can exhaust the pool under
    // concurrent load. Joining also means the role and organization binding are not reissued
    // on the inner call, which matters because RLS is silently inert under a superuser: any
    // path that accidentally ran a tenant query outside this binding would fail silently, not
    // loudly.
    return fn(store.tx);
  }

  return privilegedDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.current_org', ${String(organizationId)}, true)`);
    // Who is asking, for the project policies (migration 0031). Left unset for the system.
    if (store?.principal) {
      await tx.execute(sql`SELECT set_config('app.current_user', ${String(store.principal.userId)}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_user_role', ${store.principal.role}, true)`);
    }
    // Bind the transaction into context for the duration of fn so a nested
    // withTenantTransaction call (e.g. once Task 5 wraps handlers that already contain their
    // own privilegedDb.transaction calls, such as server/storage.ts's createUser) joins this
    // transaction instead of opening a second one.
    return tenantStore.run({ organizationId, principal: store?.principal, tx: tx as TenantTx }, () => fn(tx as TenantTx));
  });
}
