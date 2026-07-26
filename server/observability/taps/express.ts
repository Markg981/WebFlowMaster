import type { ErrorRequestHandler, Request } from 'express';
import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident, type IncidentLogger } from '../incident';

/** Headers worth keeping. Everything else is either noise or a credential. */
const HEADER_ALLOWLIST = ['content-type', 'accept', 'user-agent', 'x-correlation-id', 'x-session-id'];

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

    // Fire and forget: the response must not wait on disk I/O.
    void recordIncident({
      kind: 'server-api',
      error: err instanceof Error ? err : new Error(String(message)),
      trigger: buildServerApiTrigger(req),
      correlationId: getCorrelationId(),
      userId: (req as Request & { user?: { id?: number } }).user?.id,
    });

    logger.error('Unhandled request error', { status, message, stack: err?.stack });

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  };
}
