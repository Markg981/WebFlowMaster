/**
 * Starts the scheduler at boot without letting a failure pass unnoticed (audit A-08).
 *
 * A failed `initializeScheduler` used to be logged and forgotten: the API stayed "ready" with no
 * schedule firing. Now the start is retried in the background with bounded exponential backoff
 * and its state feeds the `scheduler` check of /readyz (503 until ready). /healthz is untouched,
 * so the pod is not killed while retrying. When the budget is spent the state stays `failed`,
 * an error is logged and readiness keeps failing; the process does not exit.
 */
export type SchedulerState = 'initializing' | 'ready' | 'failed';

export interface SchedulerBootOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  log?: {
    info(msg: string): void;
    warn(msg: string, err?: unknown): void;
    error(msg: string, err?: unknown): void;
  };
}

let state: SchedulerState = 'initializing';

export const getSchedulerState = (): SchedulerState => state;
export const resetSchedulerState = (): void => {
  state = 'initializing';
};

/** Readiness check: false unless the scheduler is up. */
export const schedulerReadiness = (): boolean => state === 'ready';

export async function startSchedulerWithRetry(
  init: () => Promise<unknown>,
  opts: SchedulerBootOptions = {},
): Promise<SchedulerState> {
  const { maxAttempts = 6, baseDelayMs = 1_000, maxDelayMs = 30_000, log } = opts;
  state = 'initializing';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await init();
      state = 'ready';
      log?.info(`Scheduler initialized (attempt ${attempt}).`);
      return state;
    } catch (err) {
      if (attempt === maxAttempts) {
        state = 'failed';
        log?.error(
          `Scheduler failed to initialize after ${maxAttempts} attempts; readiness stays failing.`,
          err,
        );
        return state;
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      log?.warn(
        `Scheduler initialization failed (attempt ${attempt}/${maxAttempts}); retrying in ${delay} ms.`,
        err,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return state;
}
