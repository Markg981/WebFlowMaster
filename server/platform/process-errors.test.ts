import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { installProcessErrorHandlers } from './process-errors';

/** A process that emits what Node would, and records what the handlers do to it. */
function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  const proc = Object.assign(emitter, { exit, exitCode: undefined as number | undefined });
  return { proc, exit };
}

describe('installProcessErrorHandlers', () => {
  it('logs an unhandled rejection with its stack and keeps the process running', () => {
    const { proc, exit } = fakeProcess();
    const logger = { error: vi.fn() };
    const shutdown = vi.fn(async () => {});
    installProcessErrorHandlers(logger, shutdown, proc as unknown as NodeJS.Process);

    const failure = new Error('forgot to await');
    proc.emit('unhandledRejection', failure, Promise.resolve());

    expect(logger.error).toHaveBeenCalledWith('Unhandled promise rejection', {
      error: 'forgot to await',
      stack: failure.stack,
    });
    expect(shutdown).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(proc.exitCode).toBeUndefined();
  });

  it('turns a rejection that is not an Error into one, so it still has a message', () => {
    const { proc } = fakeProcess();
    const logger = { error: vi.fn() };
    installProcessErrorHandlers(logger, async () => {}, proc as unknown as NodeJS.Process);

    proc.emit('unhandledRejection', 'plain string', Promise.resolve());

    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled promise rejection',
      expect.objectContaining({ error: 'plain string' }),
    );
  });

  it('logs an uncaught exception, then shuts down gracefully with a non-zero exit', async () => {
    const { proc, exit } = fakeProcess();
    const logger = { error: vi.fn() };
    const shutdown = vi.fn(async () => {});
    installProcessErrorHandlers(logger, shutdown, proc as unknown as NodeJS.Process);

    const failure = new Error('boom');
    proc.emit('uncaughtException', failure);

    expect(logger.error).toHaveBeenCalledWith('Uncaught exception; shutting down', {
      error: 'boom',
      stack: failure.stack,
    });
    expect(shutdown).toHaveBeenCalledWith('uncaughtException', 1);
    expect(proc.exitCode).toBe(1);
    await Promise.resolve();
    // The graceful path exits by itself; this only steps in when it cannot.
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits non-zero anyway when the graceful shutdown itself fails', async () => {
    const { proc, exit } = fakeProcess();
    const logger = { error: vi.fn() };
    installProcessErrorHandlers(
      logger,
      async () => {
        throw new Error('redis gone');
      },
      proc as unknown as NodeJS.Process,
    );

    proc.emit('uncaughtException', new Error('boom'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith('Shutdown after an uncaught exception failed', {
      error: 'redis gone',
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
