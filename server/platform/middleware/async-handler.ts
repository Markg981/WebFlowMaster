import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Hands an async handler's rejection to the error middleware.
 *
 * Express 4 does not look at what a handler returns: a rejected promise is an unhandled
 * rejection and the request is left hanging. Every handler in server/routes.ts used to guard
 * against that with its own try/catch, a log line and a generic 500, nineteen copies of the
 * same thing. Wrapped in this, a handler throws and incidentErrorHandler
 * (server/http/observability/taps/express.ts) logs it, records the incident and answers once.
 *
 * A handler still catches what it can answer better itself, a quota refusal or a browser
 * task's own status, and rethrows the rest.
 */
export function asyncHandler<P = Record<string, string>>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => unknown,
): RequestHandler<P> {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
}
