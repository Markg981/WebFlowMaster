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
 * The schema below caps a batch at 100 entries of up to 2000 chars each (~200KB of message
 * text alone, before JSON overhead and the other fields), but that is not the operative
 * ceiling: express.json() is mounted with no `limit` option (see server/index.ts), so its
 * 100KB default rejects an oversized request body first. Don't assume the schema's numbers
 * are the protection against a large-body DoS — they aren't reachable until a body has
 * already cleared the smaller express.json() gate.
 */

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
      // entry.meta is browser-controlled and must never be spread into the top-level meta
      // object: winston's Logger.write concatenates a `message` key onto the log message
      // (bypassing any sanitising done to the message argument above) and lets meta override
      // defaultMeta, so a spread `meta: { message: ..., source: 'server', service: 'evil',
      // userId: 1 }` could forge a line, impersonate the server, and misattribute it. Nesting
      // it under `clientMeta` keeps it inert — it can only ever collide with a key named
      // literally "clientMeta" — while source/sessionId/userId/correlationId/route/clientTs
      // stay at the top level because the server, not the browser, set them.
      // Control-character scrubbing of the message itself lives in the winston format
      // pipeline now (see redactSensitiveData in log-redactor.ts), not here.
      logger.log(entry.level, `[client] ${entry.message}`, {
        source: 'client',
        sessionId,
        userId,
        correlationId: entry.correlationId,
        route: entry.route,
        clientTs: entry.clientTs,
        clientMeta: entry.meta,
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
