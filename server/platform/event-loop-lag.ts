/**
 * Detects a blocked event loop. A heartbeat timer records when it last ran; the lag is how much
 * later than scheduled it is. A process stuck in a synchronous loop still accepts TCP
 * connections (the kernel does that), so a TCP liveness probe called it alive.
 */
export const DEFAULT_EVENT_LOOP_LAG_MS = 10_000;
const HEARTBEAT_MS = 500;

export function resolveEventLoopLagMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WORKER_EVENT_LOOP_LAG_MS?.trim();
  if (!raw) return DEFAULT_EVENT_LOOP_LAG_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000) {
    throw new Error('WORKER_EVENT_LOOP_LAG_MS must be an integer of at least 1000 (milliseconds).');
  }
  return value;
}

export function startEventLoopLagMonitor(
  thresholdMs: number = resolveEventLoopLagMs(),
  now: () => number = Date.now,
) {
  let lastTick = now();
  const timer = setInterval(() => {
    lastTick = now();
  }, HEARTBEAT_MS);
  timer.unref();
  const lagMs = () => Math.max(0, now() - lastTick - HEARTBEAT_MS);
  return {
    lagMs,
    healthy: () => lagMs() <= thresholdMs,
    stop: () => clearInterval(timer),
  };
}
