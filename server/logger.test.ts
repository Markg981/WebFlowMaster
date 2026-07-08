import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { initializeLogger } from './logger';
import { db } from './db';
import { systemSettings } from '@shared/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// These tests exercise logger initialization against the REAL (PGlite) test database.
// Instead of mocking `db`, we seed the `system_settings` table to control what the
// logger reads — this keeps the tests aligned with production behaviour and avoids
// brittle mocks that inspect Drizzle internals.

function getDailyRotateFileTransport(logger: Awaited<ReturnType<typeof initializeLogger>>) {
  return logger.transports.find((t) => t instanceof DailyRotateFile) as DailyRotateFile | undefined;
}

describe('Logger Configuration', () => {
  const originalRetention = process.env.LOG_RETENTION_DAYS;

  beforeEach(async () => {
    // Start each test from a clean settings table and env.
    await db.delete(systemSettings);
    delete process.env.LOG_RETENTION_DAYS;
  });

  afterAll(async () => {
    await db.delete(systemSettings);
    if (originalRetention === undefined) {
      delete process.env.LOG_RETENTION_DAYS;
    } else {
      process.env.LOG_RETENTION_DAYS = originalRetention;
    }
  });

  it('uses the default (7d) retention when neither env var nor DB setting is present', async () => {
    const logger = await initializeLogger();
    const transport = getDailyRotateFileTransport(logger);

    expect(transport).toBeInstanceOf(DailyRotateFile);
    const options = transport!.options;
    const expectedLogDir = path.join(__dirname, '../logs');
    expect(options.filename).toBe(path.join(expectedLogDir, 'app-%DATE%.log'));
    expect(options.datePattern).toBe('YYYY-MM-DD');
    expect(options.zippedArchive).toBe(true);
    expect(options.maxSize).toBe('20m');
    expect(options.maxFiles).toBe('7d');
  });

  it('uses the LOG_RETENTION_DAYS env var when no DB setting is found', async () => {
    process.env.LOG_RETENTION_DAYS = '10';

    const logger = await initializeLogger();
    const transport = getDailyRotateFileTransport(logger);

    expect(transport).toBeInstanceOf(DailyRotateFile);
    expect(transport!.options.maxFiles).toBe('10d');
  });

  it('uses the DB setting for logRetentionDays, overriding the env var', async () => {
    process.env.LOG_RETENTION_DAYS = '5'; // should be overridden by the DB value
    await db.insert(systemSettings).values({ key: 'logRetentionDays', value: '15' });

    const logger = await initializeLogger();
    const transport = getDailyRotateFileTransport(logger);

    expect(transport).toBeInstanceOf(DailyRotateFile);
    expect(transport!.options.maxFiles).toBe('15d');
  });
});
