import { recordHeartbeat } from './execution-state';

/**
 * What a worker keeps an eye on while it runs a plan.
 *
 * A worker used to start a run and not look up again until it was over. Nobody could stop it:
 * `cancelling` existed and nothing read it. Nothing said the worker was still alive: the
 * heartbeat was written once, when it took the run, so a worker that died left a run `running`
 * for ever. And nothing bounded it: a plan stuck on a page that never answered ran as long as
 * the process did.
 *
 * Every interval it writes the heartbeat, and the same statement tells it what the run is now:
 * - `cancelling` — somebody asked to stop it;
 * - gone — the run ended elsewhere (the recovery sweep gave up on it), so nothing more counts;
 * - past its maximum duration — it has run out of time.
 *
 * Any of the three stops the run the way a plan policy does: no test that has not started
 * starts, and a test in progress stops at its next step (the signal). A step is bounded by its
 * own timeouts, so that is soon.
 */

export type StopCause = 'cancelled' | 'timed_out' | 'lost';

export interface RunWatch {
  /** Why the run is stopping, as a sentence for the tests that will not run; null while it is not. */
  readonly stopReason: string | null;
  readonly cause: StopCause | null;
  /** Aborted when the run stops, so a test in progress stops at its next step. */
  readonly signal: AbortSignal;
  /** One heartbeat and check, now. The interval calls it; tests call it directly. */
  check(): Promise<void>;
  /** Ends the watch. Always called, however the run ends. */
  stop(): void;
}

export interface RunWatchOptions {
  intervalMs?: number;
  /** Longest a run may take, from when the worker took it. */
  maxDurationMs?: number;
  startedAt?: number;
  now?: () => number;
  heartbeat?: (executionId: string) => Promise<'running' | 'cancelling' | null>;
  onStop?: (cause: StopCause, reason: string) => void;
}

export const RUN_HEARTBEAT_INTERVAL_MS = Number(process.env.RUN_HEARTBEAT_INTERVAL_MS) || 15_000;
export const RUN_MAX_DURATION_MS = Number(process.env.RUN_MAX_DURATION_MS) || 3 * 60 * 60_000;

export function watchRun(executionId: string, options: RunWatchOptions = {}): RunWatch {
  const now = options.now ?? Date.now;
  const startedAt = options.startedAt ?? now();
  const maxDurationMs = options.maxDurationMs ?? RUN_MAX_DURATION_MS;
  const heartbeat = options.heartbeat ?? recordHeartbeat;
  const controller = new AbortController();
  let cause: StopCause | null = null;
  let stopReason: string | null = null;
  let checking = false;

  const stopWith = (why: StopCause, reason: string) => {
    if (cause) return;
    cause = why;
    stopReason = reason;
    controller.abort(new Error(reason));
    options.onStop?.(why, reason);
  };

  const check = async () => {
    // An interval that fires while the last check is still waiting on the database would only
    // pile up writes behind it.
    if (checking || cause === 'lost') return;
    checking = true;
    try {
      const status = await heartbeat(executionId);
      if (status === null) {
        stopWith('lost', 'Not run: this run was ended elsewhere while it was running.');
      } else if (status === 'cancelling') {
        stopWith('cancelled', 'Not run: the run was cancelled.');
      } else if (now() - startedAt > maxDurationMs) {
        stopWith('timed_out', `Not run: the run went past its limit of ${Math.round(maxDurationMs / 60_000)} minutes.`);
      }
    } catch {
      // A heartbeat that could not be written is not a reason to stop a run; the next one may
      // be. If none gets through, the recovery sweep decides.
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), options.intervalMs ?? RUN_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return {
    get stopReason() {
      return stopReason;
    },
    get cause() {
      return cause;
    },
    signal: controller.signal,
    check,
    stop: () => clearInterval(timer),
  };
}
