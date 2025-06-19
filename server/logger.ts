import winston from 'winston';
import 'winston-daily-rotate-file';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db'; // Import db instance
import { systemSettings } from '@shared/schema'; // Import table
import { eq } from 'drizzle-orm'; // Import eq operator

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define the log directory
const logDir = path.join(__dirname, '../logs');

// Define the log format
const logFormat = winston.format.printf(({ timestamp, level, message }) => {
  return `${timestamp} - ${level}: ${message}`;
});

async function getLogRetentionDaysSetting(): Promise<string | null> {
  try {
    const setting = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, 'logRetentionDays'))
      .limit(1);

    if (setting.length > 0 && setting[0].value) {
      const dbVal = parseInt(setting[0].value, 10);
      if (!isNaN(dbVal) && dbVal > 0) {
        return `${dbVal}d`;
      }
    }
  } catch (error) {
    // Use console.error for this critical phase as logger might not be initialized
    console.error('Failed to fetch logRetentionDays from DB:', error);
  }
  return null;
}

async function initializeLogger(): Promise<winston.Logger> {
  let maxFilesSetting = process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '7d';

  const dbRetentionSetting = await getLogRetentionDaysSetting();
  if (dbRetentionSetting) {
    maxFilesSetting = dbRetentionSetting;
  }

  const loggerInstance = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      logFormat
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        ),
      }),
      new winston.transports.DailyRotateFile({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: maxFilesSetting,
      }),
    ],
    exitOnError: false,
  });

  // Create a stream object with a 'write' function that will be used by morgan
  loggerInstance.stream = {
    write: (message: string): void => {
      loggerInstance.info(message.substring(0, message.lastIndexOf('\n')));
    },
  };

  return loggerInstance;
}

// Export a promise that resolves with the logger instance
const loggerPromise: Promise<winston.Logger> = initializeLogger();

export default loggerPromise;

// Original synchronous logger for fallback or until async logger is ready
// This might be useful in some scenarios but complicates things.
// For now, we assume the application can wait for the loggerPromise.
/*
export const syncLogger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});
loggerPromise.then(logger => {
  // Optionally, replace syncLogger or log that async logger is ready
  console.log("Async logger initialized and ready.");
}).catch(err => {
  console.error("Failed to initialize async logger:", err);
  // Application might continue with syncLogger or handle error
});
*/
