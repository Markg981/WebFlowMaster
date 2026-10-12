import { Router, type RequestHandler, type RouterOptions } from 'express';
import { asyncHandler } from './async-handler';

const ROUTE_METHODS = ['all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

/**
 * A Router whose route handlers may be async without each one guarding itself.
 *
 * Express 4 ignores what a handler returns, so in a plain Router an awaited query that throws
 * outside a try/catch is an unhandled rejection and the request hangs until the client gives
 * up. Every server/http/routes/ module creates its router here instead
 * (server/tests/architecture.test.ts), so a rejection reaches incidentErrorHandler, which logs
 * it, records the incident and answers once.
 *
 * Only route registrations are wrapped. Error handlers (four parameters) are left as they are,
 * since Express tells them apart by arity. `use` is left alone too: what it mounts is a router
 * or a middleware, and a router is not a promise.
 */
export function asyncRouter(options?: RouterOptions): Router {
  const router = Router(options);
  for (const method of ROUTE_METHODS) {
    const register = router[method].bind(router) as (...args: unknown[]) => Router;
    Object.assign(router, {
      [method]: (...args: unknown[]) => register(...args.map(wrapHandlers)),
    });
  }
  return router;
}

function wrapHandlers(arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map(wrapHandlers);
  if (typeof arg !== 'function' || arg.length >= 4) return arg;
  // The handler's own properties travel with it: a guard can carry what it checks
  // (requireScope's `scope`, read by the OpenAPI document's test).
  return Object.assign(asyncHandler(arg as RequestHandler), arg);
}
