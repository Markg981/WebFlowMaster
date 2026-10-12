import type { Logger as WinstonLogger } from 'winston';
import loggerPromise from '../logger';

export let resolvedLogger: WinstonLogger;
(async () => {
  try {
    resolvedLogger = await loggerPromise;
    if (resolvedLogger && typeof resolvedLogger.info === 'function') {
      resolvedLogger.info('PlaywrightService: Winston logger initialized successfully.');
    } else {
      // This case implies loggerPromise resolved to something unexpected or the instance is malformed
      const fallbackLogger = console; // Use console directly
      fallbackLogger.error(
        'PlaywrightService: Logger resolved but is not a valid Winston instance. Falling back to console.',
      );
      resolvedLogger = fallbackLogger as any; // Cast to any to satisfy WinstonLogger type for basic console methods
    }
  } catch (error: any) {
    const fallbackLogger = console;
    fallbackLogger.error(
      'PlaywrightService: Failed to initialize Winston logger. Falling back to console.',
      { error: error.message, stack: error.stack },
    );
    // Fallback to a console-based logger if promise rejects
    resolvedLogger = fallbackLogger as any;
  }
})();
