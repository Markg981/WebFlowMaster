/**
 * The errors nothing caught.
 *
 * Without these, Node prints an uncaught exception to stderr and exits 1, and treats an
 * unhandled rejection the same way: the process is gone, the log the operator reads (winston,
 * and Loki behind it) says nothing, and the runs in hand end as "worker lost" with no reason.
 *
 * An unhandled rejection is logged with its stack and the process goes on: it is a promise
 * somebody forgot to await, and ending every run on the machine for it is the worse harm. An
 * uncaught exception is logged the same way and then starts the ordinary graceful shutdown —
 * the one SIGTERM starts — so that connections close and jobs are handed back, and the process
 * ends non-zero, so that whatever supervises it starts another.
 */

type Logger = { error: (message: string, meta?: Record<string, unknown>) => unknown };
type Process = Pick<NodeJS.Process, 'on' | 'exit'> & { exitCode?: NodeJS.Process['exitCode'] };

export function installProcessErrorHandlers(
  logger: Logger,
  shutdown: (reason: string, exitCode: number) => Promise<void>,
  proc: Process = process,
): void {
  proc.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection', { error: error.message, stack: error.stack });
  });

  proc.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception; shutting down', { error: error.message, stack: error.stack });
    // Whatever path the shutdown takes to exit, it exits non-zero.
    proc.exitCode = 1;
    shutdown('uncaughtException', 1).catch((failure: unknown) => {
      logger.error('Shutdown after an uncaught exception failed', {
        error: failure instanceof Error ? failure.message : String(failure),
      });
      proc.exit(1);
    });
  });
}
