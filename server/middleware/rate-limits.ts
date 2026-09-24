import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { apiError } from './require-scope';

/**
 * How often a machine may call.
 *
 * Only signing in was limited. A pipeline's API key, or a script holding one, could call as fast as
 * it liked, and so could whoever tried keys or webhook tokens at the public endpoints; the only
 * brake was each organization's limit on runs. Two limits, per minute:
 *
 * - API_RATE_LIMIT (default 600) for each API key, on every route it reaches, and for each client
 *   address on /api/v1 without a valid key. Counted by key rather than by address, so pipelines
 *   sharing one outbound address do not share one budget. 600 a minute is far above what the CLI
 *   needs while it waits for a run (one status call every few seconds).
 * - WEBHOOK_RATE_LIMIT (default 120) for each client address on /api/webhooks.
 *
 * Past it the answer is 429 with Retry-After and the RateLimit headers. 0 turns a limit off.
 *
 * The counts are kept in each web process's memory, like the sign-in limit's: with several web
 * processes behind a load balancer the effective limit is that many times higher.
 */

function perMinute(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Rate limits must be whole numbers of requests per minute; got "${value}".`);
  return parsed;
}

const passThrough: RequestHandler = (_req, _res, next) => next();
const apiKeyOf = (req: Request) => (req as Request & { apiKeyId?: string }).apiKeyId;

export function apiRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const limit = perMinute(env.API_RATE_LIMIT, 600);
  if (limit === 0) return passThrough;
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // A signed-in person in a browser is not what this limits; a key, or anonymous calls to the
    // public API, are.
    skip: (req) => !apiKeyOf(req) && !req.path.startsWith('/api/v1'),
    keyGenerator: (req) => {
      const key = apiKeyOf(req);
      return key ? `key:${key}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
    },
    handler: (_req, res) => {
      apiError(res, 429, 'rate_limited', `Too many requests: at most ${limit} a minute. Wait and try again.`);
    },
  });
}

export function webhookRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const limit = perMinute(env.WEBHOOK_RATE_LIMIT, 120);
  if (limit === 0) return passThrough;
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
    handler: (_req, res) => {
      res.status(429).json({ error: `Too many requests: at most ${limit} a minute. Wait and try again.` });
    },
  });
}
