import type { ErrorRequestHandler, Request } from 'express';
import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident, type IncidentLogger } from '../incident';

/**
 * Headers worth keeping. Everything else is either noise or a credential.
 *
 * `x-wfm-session-id` is this application's own per-tab correlation id (a random
 * `s-xxxxxxxx` value, not a credential) — the unmistakably-ours name is deliberate, so
 * nothing else ever has a reason to send a value under it. The conventional `x-session-id`
 * name is deliberately NOT allowlisted: that name is where a proxy, a different client, or
 * a future reader would put a real session token, and this tap must never write one to disk.
 */
const HEADER_ALLOWLIST = ['content-type', 'accept', 'user-agent', 'x-correlation-id', 'x-wfm-session-id'];

export function buildServerApiTrigger(req: Request): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  return {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    headers,
    userId: (req as Request & { user?: { id?: number } }).user?.id,
  };
}

/**
 * Express error handler that records an incident and then behaves exactly like the
 * previous one. Mounted last, after every route.
 */
export function incidentErrorHandler(logger: IncidentLogger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || 'Internal Server Error';
    const trigger = buildServerApiTrigger(req);

    // Fire and forget: the response must not wait on disk I/O. The `.catch()` below is a
    // defensive backstop, not the primary safety net — recordIncident is documented to never
    // throw. If that contract is ever broken, this is what stands between an observability
    // bug and an unhandled rejection surfacing out of an error handler.
    void recordIncident({
      kind: 'server-api',
      error: err instanceof Error ? err : new Error(String(message)),
      trigger,
      correlationId: getCorrelationId(),
      userId: trigger.userId as number | undefined,
    }).catch((failure) => {
      // Deliberately console, not the logger: the logger may be what is broken.
      console.error('[observability] recordIncident rejected unexpectedly:', failure);
    });

    logger.error('Unhandled request error', { status, message, stack: err?.stack });

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  };
}
