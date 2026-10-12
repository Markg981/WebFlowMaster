import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { apiError } from './require-scope';
import { sharedStore } from '../platform/middleware/rate-limit-store';

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
 * - SESSION_RATE_LIMIT (default 1200) for each signed-in user, on every route: see
 *   sessionRateLimit below.
 * - HEAVY_RATE_LIMIT (default 30) for each signed-in user on the expensive routes: see
 *   heavyRateLimit below.
 *
 * Past it the answer is 429 with Retry-After and the RateLimit headers. 0 turns a limit off.
 *
 * The counts are kept in Redis (./rate-limit-store), so several web processes behind a load
 * balancer share one budget; while Redis does not answer, each process counts on its own.
 */

function perMinute(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`Rate limits must be whole numbers of requests per minute; got "${value}".`);
  return parsed;
}

const passThrough: RequestHandler = (_req, _res, next) => next();
const apiKeyOf = (req: Request) => (req as Request & { apiKeyId?: string }).apiKeyId;
const userIdOf = (req: Request) => req.user?.id;

export function apiRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const limit = perMinute(env.API_RATE_LIMIT, 600);
  if (limit === 0) return passThrough;
  return rateLimit({
    windowMs: 60_000,
    limit,
    store: sharedStore('api'),
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
      apiError(
        res,
        429,
        'rate_limited',
        `Too many requests: at most ${limit} a minute. Wait and try again.`,
      );
    },
  });
}

export function webhookRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const limit = perMinute(env.WEBHOOK_RATE_LIMIT, 120);
  if (limit === 0) return passThrough;
  return rateLimit({
    windowMs: 60_000,
    limit,
    store: sharedStore('webhook'),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
    handler: (_req, res) => {
      res
        .status(429)
        .json({ error: `Too many requests: at most ${limit} a minute. Wait and try again.` });
    },
  });
}

/**
 * How often a signed-in person may call at all.
 *
 * apiRateLimit counts keys and the anonymous public API; a browser session was counted nowhere
 * outside the expensive routes, so a script holding a session cookie could read every list as
 * fast as it liked. SESSION_RATE_LIMIT (default 1200 a minute, twenty a second) is far above
 * what the UI asks for, polling included, and stops that script. Counted for each user, so a
 * team behind one address does not share a budget. A request carrying an API key is left to
 * apiRateLimit, and one with no user to the limits of the route it reaches (sign-in has its own).
 */
export function sessionRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const limit = perMinute(env.SESSION_RATE_LIMIT, 1200);
  if (limit === 0) return passThrough;
  return rateLimit({
    windowMs: 60_000,
    limit,
    store: sharedStore('session'),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => Boolean(apiKeyOf(req)) || !userIdOf(req),
    keyGenerator: (req) => `user:${userIdOf(req)}`,
    handler: (_req, res) => {
      res
        .status(429)
        .json({ error: `Too many requests: at most ${limit} a minute. Wait and try again.` });
    },
  });
}

/**
 * How often a person may ask for the expensive things.
 *
 * apiRateLimit leaves a signed-in session alone on purpose: browsing is cheap, and a limit on it
 * would be felt long before it protected anything. Opening a browser to load a page or survey its
 * elements, proxying a request to somebody else's server, starting a recording, asking the model:
 * those are not cheap, and a script holding a session could ask for them without end. So those
 * routes carry this as well, counted for each user — by address when there is no user — so that
 * one busy person slows nobody else. Every route shares one budget (sharedHeavyRateLimit).
 */
export function heavyRateLimit(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const limit = perMinute(env.HEAVY_RATE_LIMIT, 30);
  if (limit === 0) return passThrough;
  return rateLimit({
    windowMs: 60_000,
    limit,
    store: sharedStore('heavy'),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = userIdOf(req);
      return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: `Too many requests: at most ${limit} a minute of this kind. Wait and try again.`,
      });
    },
  });
}

let heavy: RequestHandler | undefined;

/** The one instance every expensive route mounts, so a user has one budget across them all. */
export function sharedHeavyRateLimit(): RequestHandler {
  return (heavy ??= heavyRateLimit());
}
