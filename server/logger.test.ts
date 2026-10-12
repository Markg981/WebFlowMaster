import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import logger, { applyLogSettings, currentFileTransport } from './logger';
import { privilegedDb } from './db';
import { systemSettings } from '@shared/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The settings tests run against the REAL (PGlite) test database: we seed the `system_settings`
// table to control what the logger reads, instead of mocking `privilegedDb`.

function fileTransports(instance: typeof logger) {
  return instance.transports.filter((t) => t instanceof DailyRotateFile) as DailyRotateFile[];
}

/** A fresh copy of the module, so it is created again from the current environment. */
async function freshLogger() {
  vi.resetModules();
  return (await import('./logger')).default;
}

// Before the environment tests: those reset the module registry, after which applyLogSettings'
// own import of ./db would open a second database rather than the one seeded here.
describe('applyLogSettings', () => {
  const levelBefore = logger.level;

  beforeEach(async () => {
    await privilegedDb.delete(systemSettings);
  });

  afterAll(async () => {
    await privilegedDb.delete(systemSettings);
    logger.level = levelBefore;
    logger.transports.forEach((t) => {
      t.level = undefined;
    });
  });

  it('replaces the file transport with the retention saved in the DB', async () => {
    const before = currentFileTransport();
    await privilegedDb.insert(systemSettings).values({ key: 'logRetentionDays', value: '15' });

    await applyLogSettings();

    const transports = fileTransports(logger);
    expect(transports).toHaveLength(1);
    expect(transports[0]).toBe(currentFileTransport());
    expect(transports[0]).not.toBe(before);
    expect(transports[0].options.maxFiles).toBe('15d');
  });

  it('applies the log level saved in the DB to the logger and its transports', async () => {
    await privilegedDb.insert(systemSettings).values({ key: 'logLevel', value: 'warn' });

    await applyLogSettings();

    expect(logger.level).toBe('warn');
    expect(logger.transports.every((t) => t.level === 'warn')).toBe(true);
  });

  it('leaves the current values when the DB has none or malformed ones', async () => {
    const transport = currentFileTransport();
    const level = logger.level;
    await privilegedDb.insert(systemSettings).values([
      { key: 'logRetentionDays', value: 'forever' },
      { key: 'logLevel', value: 'loud' },
    ]);

    await applyLogSettings();

    expect(currentFileTransport()).toBe(transport);
    expect(logger.level).toBe(level);
  });
});

describe('Logger configuration from the environment', () => {
  const originalRetention = process.env.LOG_RETENTION_DAYS;
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    for (const [key, value] of [
      ['LOG_RETENTION_DAYS', originalRetention],
      ['LOG_LEVEL', originalLevel],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is usable synchronously, without awaiting anything', () => {
    expect(typeof logger.info).toBe('function');
    expect(fileTransports(logger)).toHaveLength(1);
  });

  it('uses the default (7d) retention and info level when no env var is set', async () => {
    delete process.env.LOG_RETENTION_DAYS;
    delete process.env.LOG_LEVEL;
    const instance = await freshLogger();
    const [transport] = fileTransports(instance);

    const options = transport.options;
    const expectedLogDir = path.join(__dirname, '../logs');
    expect(options.filename).toBe(path.join(expectedLogDir, 'app-%DATE%.log'));
    expect(options.datePattern).toBe('YYYY-MM-DD');
    expect(options.zippedArchive).toBe(true);
    expect(options.maxSize).toBe('20m');
    expect(options.maxFiles).toBe('7d');
    expect(instance.level).toBe('info');
  });

  it('uses LOG_RETENTION_DAYS and LOG_LEVEL', async () => {
    process.env.LOG_RETENTION_DAYS = '10';
    process.env.LOG_LEVEL = 'debug';
    const instance = await freshLogger();

    expect(fileTransports(instance)[0].options.maxFiles).toBe('10d');
    expect(instance.level).toBe('debug');
  });

  it('ignores an unknown LOG_LEVEL', async () => {
    process.env.LOG_LEVEL = 'loud';
    const instance = await freshLogger();

    expect(instance.level).toBe('info');
  });
});
