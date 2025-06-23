import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to get a fresh logger instance for testing environment effects
async function getTestLoggerInstance() {
  // Resetting modules ensures that logger.ts (and its dependencies like db) are re-evaluated.
  // This is crucial for tests that modify process.env or mock dependencies.
  vi.resetModules();
  const { default: promise } = await import('./logger'); // logger.ts exports a promise
  return await promise; // await the promise to get the logger instance
}

describe('Logger Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env }; // Save original env

    // Mock db calls for these specific logger tests to isolate logger's initialization logic
    // from actual database state or availability during tests.
    vi.mock('./db', async (importOriginal) => {
      const actualDbModule = await importOriginal() as any;
      return {
        ...actualDbModule, // Spread any other exports from the actual db module
        db: { // Mock only the db object and its select method used by logger
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                // Simulate DB returning no settings for logRetentionDays or logLevel
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          // If logger's db interaction becomes more complex, mock other methods here.
        },
      };
    });
  });

  afterEach(() => {
    process.env = originalEnv; // Restore original env
    vi.unmock('./db'); // IMPORTANT: Unmock './db' so other test suites get the real db
    vi.resetModules(); // Clean up modules for subsequent test suites
  });

  it('should have DailyRotateFile transport configured with default (7d) when no env var or DB setting', async () => {
    delete process.env.LOG_RETENTION_DAYS; // Ensure env var is not set

    const logger = await getTestLoggerInstance(); // This will use the mocked db

    const dailyRotateFileTransport = logger.transports.find(
      transport => transport instanceof DailyRotateFile
    ) as DailyRotateFile | undefined;

    expect(dailyRotateFileTransport).toBeInstanceOf(DailyRotateFile);
    if (dailyRotateFileTransport) {
      const options = dailyRotateFileTransport.options;
      const expectedLogDir = path.join(__dirname, '../logs');
      expect(options.filename).toBe(path.join(expectedLogDir, 'app-%DATE%.log'));
      expect(options.datePattern).toBe('YYYY-MM-DD');
      expect(options.zippedArchive).toBe(true);
      expect(options.maxSize).toBe('20m');
      expect(options.maxFiles).toBe('7d'); // Default from logger.ts logic
    }
  });

  it('should use LOG_RETENTION_DAYS env var if DB setting is not found', async () => {
    process.env.LOG_RETENTION_DAYS = '10'; // Set env var

    const logger = await getTestLoggerInstance(); // This will use the mocked db

    const dailyRotateFileTransport = logger.transports.find(
      transport => transport instanceof DailyRotateFile
    ) as DailyRotateFile | undefined;

    expect(dailyRotateFileTransport).toBeInstanceOf(DailyRotateFile);
    if (dailyRotateFileTransport) {
      expect(dailyRotateFileTransport.options.maxFiles).toBe('10d'); // Should pick up the env var
    }
  });

  it('should use DB setting for logRetentionDays if available and valid, overriding env var', async () => {
    process.env.LOG_RETENTION_DAYS = '5'; // This should be overridden by DB

    // Specific mock for this test case where DB returns a value for logRetentionDays
    vi.resetModules(); // Reset modules before applying a new mock specific to this test
    vi.doMock('./db', async (importOriginal) => { // Use doMock for specific, scoped mock
        const actualDbModule = await importOriginal() as any;
        return {
            ...actualDbModule,
            db: {
                ...actualDbModule.db,
                select: vi.fn().mockImplementation(() => ({
                    from: vi.fn().mockImplementation(() => ({
                        where: vi.fn().mockImplementation((condition) => {
                            if (condition && typeof condition !== 'function' && 'column' in condition && condition.column.name === 'key' && condition.value === 'logRetentionDays') {
                                return { limit: vi.fn().mockResolvedValue([{ value: '15' }]) };
                            }
                            if (condition && typeof condition !== 'function' && 'column' in condition && condition.column.name === 'key' && condition.value === 'logLevel') {
                                return { limit: vi.fn().mockResolvedValue([{ value: 'info' }]) };
                            }
                            return { limit: vi.fn().mockResolvedValue([]) };
                        }),
                    })),
                })),
            },
        };
    });

    const logger = await getTestLoggerInstance();
    const transport = logger.transports.find(t => t instanceof DailyRotateFile) as DailyRotateFile | undefined;

    expect(transport).toBeInstanceOf(DailyRotateFile);
    if (transport) {
        expect(transport.options.maxFiles).toBe('15d');
    }
    vi.doUnmock('./db'); // Clean up the specific mock
  });
});
