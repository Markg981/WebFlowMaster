import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import loggerPromise from '../logger';
import { ClientLogBatchSchema, ClientIncidentReportSchema } from '@shared/observability';
import { recordIncident } from '../observability/incident';

const router = Router();
const logger = await loggerPromise;

const isProduction = process.env.NODE_ENV === 'production';

/**
 * The login page is the one screen a user can be on while unauthenticated, and it is
 * exactly where a broken build shows up first. Outside production the endpoints accept
 * anonymous reports; in production they stay closed, because an open disk-writing
 * endpoint is a disk-exhaustion and log-injection vector.
 */
function allowAnonymousOutsideProduction(req: Request, res: Response, next: NextFunction): void {
  if (!isProduction) return next();
  if (req.isAuthenticated?.() && req.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many log batches, slow down.' },
});

/**
 * The schema caps message length but does not forbid control characters. A message
 * containing "\n2026-...Z ERROR fake line" would otherwise forge additional log lines in
 * the file a human (or another tool) reads back — a log-injection vector, since the
 * browser fully controls this string. Collapsing CR/LF/NUL to spaces keeps each client
 * entry to the single line it re-emits as.
 */
function sanitizeForLogLine(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ');
}

router.post(
  '/api/client-logs',
  allowAnonymousOutsideProduction,
  ingestLimiter,
  (req: Request, res: Response) => {
    const parsed = ClientLogBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid log batch', details: parsed.error.flatten() });
    }

    const { sessionId, entries, dropped } = parsed.data;
    const userId = (req as Request & { user?: { id?: number } }).user?.id;

    for (const entry of entries) {
      // Re-emitted at the browser's own level so the file reads as one interleaved stream.
      logger.log(entry.level, `[client] ${sanitizeForLogLine(entry.message)}`, {
        source: 'client',
        sessionId,
        userId,
        correlationId: entry.correlationId,
        route: entry.route,
        clientTs: entry.clientTs,
        ...entry.meta,
      });
    }

    if (dropped && dropped > 0) {
      logger.warn(`[client] buffer overflow, dropped ${dropped} entries`, { source: 'client', sessionId });
    }

    res.status(202).json({ accepted: entries.length });
  },
);

router.post(
  '/api/incidents',
  allowAnonymousOutsideProduction,
  ingestLimiter,
  async (req: Request, res: Response) => {
    const parsed = ClientIncidentReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid incident report', details: parsed.error.flatten() });
    }

    const report = parsed.data;
    const error = new Error(report.message);
    error.name = report.name;
    error.stack = report.stack ?? `${report.name}: ${report.message}`;

    const incident = await recordIncident({
      kind: 'client-runtime',
      error,
      trigger: {
        route: report.route,
        componentStack: report.componentStack,
        props: report.props,
      },
      correlationId: report.correlationId,
      sessionId: report.sessionId,
      userId: (req as Request & { user?: { id?: number } }).user?.id,
      breadcrumbs: report.breadcrumbs,
    });

    res.status(202).json({ incidentId: incident?.id ?? null });
  },
);

export default router;
