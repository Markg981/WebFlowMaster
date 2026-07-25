import { Redis } from 'ioredis';
import { createClient } from 'redis';
import loggerPromise from './logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  // Connect on first command rather than at import time, so modules that import
  // this (e.g. auth for sessions) don't force a Redis connection when none is used
  // (e.g. tests using an in-memory session store).
  lazyConnect: true,
});

connection.on('error', async (error) => {
  const logger = await loggerPromise;
  logger.error('Redis connection error:', error);
});

connection.on('ready', async () => {
  const logger = await loggerPromise;
  logger.info('Redis connection established successfully.');
});

// Separate client for the express-session store: connect-redis targets node-redis
// (peer dep `redis` >= 5) and calls set(key, val, {EX}), mGet() and scanIterator(),
// which ioredis does not implement — passing the ioredis client makes Redis reject the
// malformed SET with "ERR syntax error" and every login fails. BullMQ, in turn, requires
// ioredis, so the two clients coexist against the same server.
export const sessionRedis = createClient({ url: redisUrl });

sessionRedis.on('error', async (error) => {
  const logger = await loggerPromise;
  logger.error('Session Redis connection error:', error);
});

let sessionRedisConnecting: Promise<void> | null = null;

/** Connects the session client once; safe to call repeatedly. */
export function connectSessionRedis(): Promise<void> {
  if (!sessionRedisConnecting) {
    sessionRedisConnecting = sessionRedis
      .connect()
      .then(async () => {
        const logger = await loggerPromise;
        logger.info('Session Redis connection established successfully.');
      })
      .catch(async (error) => {
        const logger = await loggerPromise;
        logger.error('Session Redis failed to connect; sessions will not persist.', error);
        sessionRedisConnecting = null; // allow a later retry
        throw error;
      });
  }
  return sessionRedisConnecting;
}
