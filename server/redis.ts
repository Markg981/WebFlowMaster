import { Redis } from 'ioredis';
import loggerPromise from './logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

connection.on('error', async (error) => {
  const logger = await loggerPromise;
  logger.error('Redis connection error:', error);
});

connection.on('ready', async () => {
  const logger = await loggerPromise;
  logger.info('Redis connection established successfully.');
});
