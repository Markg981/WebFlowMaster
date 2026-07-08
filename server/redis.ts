import { Redis } from 'ioredis';
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
