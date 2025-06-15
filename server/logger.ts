import winston from 'winston';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define the log directory and ensure it exists
const logDir = path.join(__dirname, '../logs');

// Define the log format
const logFormat = winston.format.printf(({ timestamp, level, message }) => {
  return `${timestamp} - ${level}: ${message}`;
});

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // Default to 'info' if LOG_LEVEL is not set
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5, // Keep up to 5 log files
      tailable: true, // When maxFiles is reached, the oldest file will be removed.
    })
  ],
  exitOnError: false // Do not exit on handled exceptions
});

// Create a stream object with a 'write' function that will be used by morgan
logger.stream = {
  write: (message: string): void => {
    logger.info(message.substring(0, message.lastIndexOf('\n')));
  }
};

export default logger;
