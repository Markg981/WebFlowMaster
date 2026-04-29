import winston from 'winston';
import 'winston-daily-rotate-file';
import LokiTransport from 'winston-loki';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db';
import { systemSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getCorrelationId } from './middleware/correlation';
import { redactSensitiveData } from './utils/log-redactor';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define the log directory
const logDir = path.join(__dirname, '../logs');

// Service name for structured logs
const SERVICE_NAME = 'webflowmaster-api';

// ─── Structured JSON format (for file transport & prod console) ───────────────
// Every log line is a parseable JSON object with consistent fields.
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), // ISO 8601
  winston.format.errors({ stack: true }),                              // Capture stack traces
  winston.format((info) => {
    // Inject service name
    info.service = SERVICE_NAME;
    // Inject correlation ID from AsyncLocalStorage (if available)
    const correlationId = getCorrelationId();
    if (correlationId) {
      info.correlationId = correlationId;
    }
    return info;
  })(),
  redactSensitiveData(),                                               // Mask PII/secrets
  winston.format.json()                                                // Output as JSON
);

// ─── Human-readable format (for dev console only) ─────────────────────────────
const devConsoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format((info) => {
    const correlationId = getCorrelationId();
    if (correlationId) {
      info.correlationId = correlationId;
    }
    return info;
  })(),
  redactSensitiveData(),
  winston.format.printf(({ timestamp, level, message, correlationId, service, ...metadata }) => {
    const cid = correlationId ? ` [${correlationId}]` : '';
    let metaString = '';
    // Filter out Symbol keys and internal Winston fields
    const cleanMeta = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => !key.startsWith('Symbol') && key !== 'splat')
    );
    if (Object.keys(cleanMeta).length > 0) {
      metaString = ` ${JSON.stringify(cleanMeta)}`;
    }
    return `${timestamp} ${level}${cid}: ${message}${metaString}`;
  })
);

// ─── DB setting helpers ───────────────────────────────────────────────────────

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

// Valid log levels for Winston
const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

async function getLogLevelSetting(): Promise<string> {
  try {
    const setting = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, 'logLevel'))
      .limit(1);

    if (setting.length > 0 && setting[0].value && VALID_LOG_LEVELS.includes(setting[0].value)) {
      return setting[0].value;
    }
  } catch (error) {
    console.error('Failed to fetch logLevel from DB:', error);
  }
  // Fallback to environment variable or 'info'
  return process.env.LOG_LEVEL || 'info';
}

// ─── Logger initialization ────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production';

async function initializeLogger(): Promise<winston.Logger> {
  let maxFilesSetting = process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '7d';

  const dbRetentionSetting = await getLogRetentionDaysSetting();
  if (dbRetentionSetting) {
    maxFilesSetting = dbRetentionSetting;
  }

  const logLevelFromDb = await getLogLevelSetting();

  const loggerInstance = winston.createLogger({
    level: logLevelFromDb,
    // Default format for all transports (structured JSON)
    format: structuredFormat,
    defaultMeta: { service: SERVICE_NAME },
    transports: [
      // Console: human-readable in dev, JSON in prod
      new winston.transports.Console({
        format: isDev ? devConsoleFormat : structuredFormat,
      }),
      // File: always structured JSON (for machine parsing / aggregation)
      new winston.transports.DailyRotateFile({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: maxFilesSetting,
        // File transport inherits the parent structuredFormat
      }),
    ],
    exitOnError: false,
  });

  // ─── Grafana Loki transport (production / when LOKI_URL is set) ───────────
  // Logs are batched in memory and pushed via HTTP every 5 seconds.
  // This adds zero latency to API responses.
  if (process.env.LOKI_URL) {
    loggerInstance.add(new LokiTransport({
      host: process.env.LOKI_URL,
      labels: { app: 'webflowmaster', service: SERVICE_NAME },
      json: true,
      batching: true,
      interval: 5,
      gracefulShutdown: true,
      onConnectionError: (err: any) => console.error('[Loki] Connection error:', err),
    }));
    loggerInstance.info(`Loki transport enabled, pushing to ${process.env.LOKI_URL}`);
  }

  // Create a stream object with a 'write' function that will be used by morgan
  (loggerInstance as any).stream = {
    write: (message: string): void => {
      loggerInstance.http(message.substring(0, message.lastIndexOf('\n')));
    },
  };

  return loggerInstance;
}

// Export a promise that resolves with the logger instance
const loggerPromise: Promise<winston.Logger> = initializeLogger();

export default loggerPromise;

export async function updateLogLevel(newLevel: string): Promise<void> {
  if (!VALID_LOG_LEVELS.includes(newLevel)) {
    const logger = await loggerPromise;
    logger.warn(`Attempted to set invalid log level: ${newLevel}. Valid levels are: ${VALID_LOG_LEVELS.join(', ')}.`);
    return;
  }

  const logger = await loggerPromise;
  logger.level = newLevel;

  // Also update level on all transports
  logger.transports.forEach(transport => {
    transport.level = newLevel;
  });

  logger.info(`Log level updated to: ${newLevel}`);
}

// Re-export for convenience
export { VALID_LOG_LEVELS };
