import winston from 'winston';
import 'winston-daily-rotate-file';
import { LokiTransport } from './loki-transport';
import path from 'path';
import { traceLogFields } from '../../shared/telemetry';
import { APP_ROOT } from './app-root';
import { getCorrelationId } from './middleware/correlation';
import { redactSensitiveData, scrubControlCharsFromMessage } from './utils/log-redactor';

// Define the log directory
const logDir = path.join(APP_ROOT, 'logs');

// Service name for structured logs
const SERVICE_NAME = 'webflowmaster-api';

// ─── Structured JSON format (for file transport & prod console) ───────────────
// Every log line is a parseable JSON object with consistent fields.
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), // ISO 8601
  winston.format.errors({ stack: true }), // Capture stack traces
  winston.format((info) => {
    // Inject service name
    info.service = SERVICE_NAME;
    Object.assign(info, traceLogFields());
    // Inject correlation ID from AsyncLocalStorage (if available)
    const correlationId = getCorrelationId();
    if (correlationId) {
      info.correlationId = correlationId;
    }
    return info;
  })(),
  redactSensitiveData(), // Mask PII/secrets
  scrubControlCharsFromMessage(), // Strip CR/LF/NUL from message (see log-redactor.ts)
  winston.format.json(), // Output as JSON
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
  scrubControlCharsFromMessage(), // Strip CR/LF/NUL from message — this is the format that interpolates it raw (see log-redactor.ts)
  winston.format.printf(({ timestamp, level, message, correlationId, service, ...metadata }) => {
    const cid = correlationId ? ` [${correlationId}]` : '';
    let metaString = '';
    // Filter out Symbol keys and internal Winston fields
    const cleanMeta = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => !key.startsWith('Symbol') && key !== 'splat'),
    );
    if (Object.keys(cleanMeta).length > 0) {
      metaString = ` ${JSON.stringify(cleanMeta)}`;
    }
    return `${timestamp} ${level}${cid}: ${message}${metaString}`;
  }),
);

// ─── Logger ───────────────────────────────────────────────────────────────────
//
// Created synchronously, so any module can log from the moment it is imported — db.ts among
// them, which loads before anything could have read a setting. It starts from the environment
// (LOG_LEVEL, LOG_RETENTION_DAYS); applyLogSettings() then brings in the values an administrator
// saved in system_settings, once the process has checked its database.

// Valid log levels for Winston
const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

const isDev = process.env.NODE_ENV !== 'production';

function envLogLevel(): string {
  const level = process.env.LOG_LEVEL;
  return level && VALID_LOG_LEVELS.includes(level) ? level : 'info';
}

function envRetention(): string {
  return process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '7d';
}

function createFileTransport(
  maxFiles: string,
): InstanceType<typeof winston.transports.DailyRotateFile> {
  // Always structured JSON (for machine parsing / aggregation): inherits the logger's format.
  return new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles,
  });
}

let fileTransport = createFileTransport(envRetention());

const logger = winston.createLogger({
  level: envLogLevel(),
  // Default format for all transports (structured JSON)
  format: structuredFormat,
  defaultMeta: { service: SERVICE_NAME },
  transports: [
    // Console: human-readable in dev, JSON in prod
    new winston.transports.Console({
      format: isDev ? devConsoleFormat : structuredFormat,
    }),
    fileTransport,
  ],
  exitOnError: false,
});

// ─── Grafana Loki transport (production / when LOKI_URL is set) ───────────────
// Logs are batched in memory and pushed via HTTP every 5 seconds.
// This adds zero latency to API responses. See server/platform/loki-transport.ts.
let lokiTransport: LokiTransport | undefined;
if (process.env.LOKI_URL) {
  lokiTransport = new LokiTransport({
    host: process.env.LOKI_URL,
    labels: { app: 'webflowmaster', service: SERVICE_NAME },
    intervalSeconds: 5,
  });
  logger.add(lokiTransport);
  logger.info(`Loki transport enabled, pushing to ${process.env.LOKI_URL}`);
}

// Create a stream object with a 'write' function that will be used by morgan
(logger as any).stream = {
  write: (message: string): void => {
    logger.http(message.substring(0, message.lastIndexOf('\n')));
  },
};

export default logger;

/** Sends the lines still waiting for the next Loki push; for a shutdown, before process.exit. */
export async function flushLogs(): Promise<void> {
  await lokiTransport?.flush();
}

/** The file transport, for the tests: its retention is what applyLogSettings may replace. */
export function currentFileTransport(): InstanceType<typeof winston.transports.DailyRotateFile> {
  return fileTransport;
}

// ─── Settings from the database ───────────────────────────────────────────────

async function readSetting(key: string): Promise<string | null> {
  // Imported here rather than at the top: db.ts logs through this module, and a static import
  // back to it would make the two depend on each other's initialisation order.
  const [{ privilegedDb }, { systemSettings }, { eq }] = await Promise.all([
    import('./db'),
    import('@shared/schema'),
    import('drizzle-orm'),
  ]);
  const rows = await privilegedDb
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

/**
 * Applies the log level and the file retention saved in system_settings, over the environment
 * values the logger started with. A setting that is missing, malformed or unreadable leaves the
 * current value in place: logging must never be what stops the process starting.
 */
export async function applyLogSettings(): Promise<void> {
  try {
    const level = await readSetting('logLevel');
    if (level && VALID_LOG_LEVELS.includes(level)) {
      setLevel(level);
    }
  } catch (error) {
    logger.error('Failed to fetch logLevel from DB:', error);
  }

  try {
    const days = parseInt((await readSetting('logRetentionDays')) ?? '', 10);
    if (!isNaN(days) && days > 0) {
      setRetention(`${days}d`);
    }
  } catch (error) {
    logger.error('Failed to fetch logRetentionDays from DB:', error);
  }
}

function setLevel(level: string): void {
  logger.level = level;
  // Also update level on all transports
  logger.transports.forEach((transport) => {
    transport.level = level;
  });
}

// DailyRotateFile takes its retention at construction only, so a different one means a new
// transport in place of the old.
function setRetention(maxFiles: string): void {
  if (fileTransport.options.maxFiles === maxFiles) return;
  const previous = fileTransport;
  fileTransport = createFileTransport(maxFiles);
  fileTransport.level = previous.level;
  logger.add(fileTransport);
  logger.remove(previous);
  previous.close?.();
}

export function updateLogLevel(newLevel: string): void {
  if (!VALID_LOG_LEVELS.includes(newLevel)) {
    logger.warn(
      `Attempted to set invalid log level: ${newLevel}. Valid levels are: ${VALID_LOG_LEVELS.join(', ')}.`,
    );
    return;
  }

  setLevel(newLevel);
  logger.info(`Log level updated to: ${newLevel}`);
}

// Re-export for convenience
export { VALID_LOG_LEVELS };
