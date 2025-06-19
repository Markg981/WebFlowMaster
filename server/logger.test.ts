import logger from './logger';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Logger Configuration', () => {
  it('should have DailyRotateFile transport configured correctly with default retention', () => {
    const dailyRotateFileTransport = logger.transports.find(
      transport => transport instanceof DailyRotateFile
    );

    expect(dailyRotateFileTransport).toBeInstanceOf(DailyRotateFile);

    if (dailyRotateFileTransport) {
      const options = (dailyRotateFileTransport as DailyRotateFile).options;
      // Correct the expected filename by resolving the path as it is in logger.ts
      const expectedLogDir = path.join(__dirname, '../logs');
      expect(options.filename).toBe(path.join(expectedLogDir, 'app-%DATE%.log'));
      expect(options.datePattern).toBe('YYYY-MM-DD');
      expect(options.zippedArchive).toBe(true);
      expect(options.maxSize).toBe('20m');
      expect(options.maxFiles).toBe('7d'); // Default value
    }
  });

  it('should have DailyRotateFile transport configured correctly with custom retention', async () => {
    // Mock process.env.LOG_RETENTION_DAYS
    const originalEnv = { ...process.env }; // Shallow copy to restore later
    process.env.LOG_RETENTION_DAYS = '10';

    // Reset modules to ensure logger.ts is re-evaluated with the new environment variable
    vi.resetModules();
    const { default: loggerWithCustomEnv } = await import('./logger');

    const dailyRotateFileTransport = loggerWithCustomEnv.transports.find(
      transport => transport instanceof DailyRotateFile
    ) as DailyRotateFile | undefined;

    expect(dailyRotateFileTransport).toBeInstanceOf(DailyRotateFile);

    if (dailyRotateFileTransport) {
      const options = dailyRotateFileTransport.options;
      expect(options.maxFiles).toBe('10d'); // Should reflect the mocked value
    }

    // Restore original process.env
    process.env = originalEnv;
  });
});
