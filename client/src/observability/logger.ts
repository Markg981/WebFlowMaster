import type { ClientLogEntry, ClientLogLevel } from '@shared/observability';
import { getSessionId } from './session';

const LEVEL_ORDER: Record<ClientLogLevel, number> = {
  error: 0, warn: 1, info: 2, http: 3, debug: 4,
};

const INGEST_URL = '/api/client-logs';
const FLUSH_INTERVAL_MS = 3000;
const FLUSH_AT_ENTRIES = 25;
const MAX_BUFFER = 200;
const MAX_RETRIES = 3;

let level: ClientLogLevel = 'info';
let buffer: ClientLogEntry[] = [];
let dropped = 0;
let retries = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let currentRoute = '';
let currentCorrelationId: string | undefined;

export function setLogLevel(next: ClientLogLevel): void {
  level = next;
}

/** Called by the router hook so every entry carries the page it came from. */
export function setCurrentRoute(route: string): void {
  currentRoute = route;
}

/** Called by the request wrapper so log lines join the server trace. */
export function setCurrentCorrelationId(correlationId: string | undefined): void {
  currentCorrelationId = correlationId;
}

function payload(): string {
  return JSON.stringify({ sessionId: getSessionId(), entries: buffer, dropped });
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => { void flushNow(); }, FLUSH_INTERVAL_MS);
  // Do not hold a Node test process open.
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Sends whatever is buffered.
 *
 * Failures here go to the console, never back through this logger: a transport that logs
 * its own failure queues another send that fails, which queues another. Retries are
 * bounded and the batch is then abandoned rather than accumulated forever.
 */
export async function flushNow(): Promise<void> {
  if (buffer.length === 0) return;
  if (typeof fetch !== 'function') return;

  const body = payload();
  const sent = buffer;
  const sentDropped = dropped;
  buffer = [];
  dropped = 0;

  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'include',
      keepalive: true,
    });
    retries = 0;
  } catch (error) {
    retries += 1;
    if (retries <= MAX_RETRIES) {
      buffer = [...sent, ...buffer].slice(-MAX_BUFFER);
      dropped += sentDropped;
    } else {
      console.warn('[observability] dropping client log batch after repeated failures', error);
      retries = 0;
    }
  }
}

function enqueue(entryLevel: ClientLogLevel, message: string, meta?: Record<string, unknown>): void {
  try {
    if (LEVEL_ORDER[entryLevel] > LEVEL_ORDER[level]) return;

    buffer.push({
      level: entryLevel,
      message: String(message).slice(0, 2000),
      clientTs: new Date().toISOString(),
      correlationId: currentCorrelationId,
      route: currentRoute || undefined,
      meta,
    });

    if (buffer.length > MAX_BUFFER) {
      dropped += buffer.length - MAX_BUFFER;
      buffer = buffer.slice(-MAX_BUFFER);
    }

    ensureTimer();
    if (entryLevel === 'error' || buffer.length >= FLUSH_AT_ENTRIES) void flushNow();
  } catch (error) {
    console.warn('[observability] client logger failed', error);
  }
}

export const clientLogger = {
  error: (message: string, meta?: Record<string, unknown>) => enqueue('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => enqueue('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => enqueue('info', message, meta),
  http: (message: string, meta?: Record<string, unknown>) => enqueue('http', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => enqueue('debug', message, meta),
};

/**
 * `fetch` is cancelled during page dismissal; sendBeacon is the only transport the browser
 * guarantees, and dismissal is exactly when the interesting error would otherwise be lost.
 */
function flushWithBeacon(): void {
  try {
    if (buffer.length === 0 || typeof navigator?.sendBeacon !== 'function') return;
    const blob = new Blob([payload()], { type: 'application/json' });
    navigator.sendBeacon(INGEST_URL, blob);
    buffer = [];
    dropped = 0;
  } catch {
    // Nothing useful can be done while the page is going away.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWithBeacon);
}

/** Test seam: clears module state between cases. */
export function __resetForTests(): void {
  buffer = [];
  dropped = 0;
  retries = 0;
  level = 'info';
  currentRoute = '';
  currentCorrelationId = undefined;
  if (timer !== null) { clearInterval(timer); timer = null; }
}
