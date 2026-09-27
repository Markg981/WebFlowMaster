import Transport, { type TransportStreamOptions } from 'winston-transport';

/**
 * Pushes log lines to Grafana Loki (/loki/api/v1/push, JSON body).
 *
 * This replaces winston-loki, which sent nothing a stock Loki would keep. It put every entry's
 * winston metadata (service, correlationId, statusCode...) in the third slot of each value, which
 * Loki reads as structured metadata: disabled by default in 2.9, and not parseable at all once a
 * value is not a string. Every push was answered 400 — and winston-loki resolves its request
 * whatever the status, so "Loki transport enabled" was the last anyone heard of it.
 *
 * Here a value is [timestamp, line] and nothing else. The line is the formatted JSON the other
 * transports write, so every field stays queryable with `| json`; the labels are few and fixed,
 * as Loki wants them. A rejected push is said out loud, once per change of state.
 */

const LEVEL = Symbol.for('level');
const MESSAGE = Symbol.for('message');

/** Past this many unsent lines (Loki down for a long while) the oldest are dropped. */
const MAX_BUFFERED = 10_000;

export interface LokiTransportOptions extends TransportStreamOptions {
  /** Base URL of Loki, e.g. http://loki:3100. */
  host: string;
  labels: Record<string, string>;
  /** Seconds between pushes. */
  intervalSeconds?: number;
  fetch?: typeof fetch;
  /** Where failures are reported; console.error by default, since the logger is what failed. */
  report?: (message: string) => void;
}

type Entry = { level: string; ts: string; line: string };

export class LokiTransport extends Transport {
  private readonly url: string;
  private readonly labels: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly report: (message: string) => void;
  private readonly timer: NodeJS.Timeout;
  private buffer: Entry[] = [];
  private failing = false;

  constructor(options: LokiTransportOptions) {
    super(options);
    this.url = `${options.host.replace(/\/+$/, '')}/loki/api/v1/push`;
    this.labels = options.labels;
    this.fetchImpl = options.fetch ?? fetch;
    this.report = options.report ?? ((message) => console.error(message));
    this.timer = setInterval(() => void this.flush(), (options.intervalSeconds ?? 5) * 1000);
    this.timer.unref();
  }

  log(info: Record<string | symbol, unknown>, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));
    this.buffer.push({
      level: String(info[LEVEL] ?? info.level),
      // Nanoseconds, as a string: past 2^53, so not a JSON number.
      ts: `${BigInt(Date.now()) * 1_000_000n}`,
      line: String(info[MESSAGE] ?? info.message),
    });
    if (this.buffer.length > MAX_BUFFERED) this.buffer.splice(0, this.buffer.length - MAX_BUFFERED);
    callback();
  }

  /** Sends what is buffered. Resolves once Loki has answered, or the attempt has failed. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const sending = this.buffer;
    this.buffer = [];

    const byLevel = new Map<string, [string, string][]>();
    for (const { level, ts, line } of sending) {
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level)!.push([ts, line]);
    }
    const body = JSON.stringify({
      streams: [...byLevel].map(([level, values]) => ({ stream: { ...this.labels, level }, values })),
    });

    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        if (this.failing) this.report(`[Loki] Pushing to ${this.url} again.`);
        this.failing = false;
        return;
      }
      // Retrying cannot fix what Loki refused as malformed; a 429 or a 5xx may pass later.
      if (res.status === 429 || res.status >= 500) this.requeue(sending);
      this.fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    } catch (error) {
      this.requeue(sending);
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  close(): void {
    clearInterval(this.timer);
    void this.flush();
  }

  private requeue(entries: Entry[]): void {
    this.buffer = entries.concat(this.buffer).slice(-MAX_BUFFERED);
  }

  private fail(reason: string): void {
    if (!this.failing) this.report(`[Loki] Push to ${this.url} failed, logs are not reaching Loki: ${reason}`);
    this.failing = true;
  }
}
