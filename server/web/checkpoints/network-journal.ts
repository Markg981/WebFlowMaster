import { createHash } from 'node:crypto';
import type { BrowserContext, Request } from 'playwright';
import type { NetworkCheckpointEntry } from '@shared/comparison';
import { urlPatternMatcher } from '@shared/patterns';

/**
 * The requests a test's pages made, kept for its `checkpointNetwork` steps
 * (docs/superpowers/specs/2026-11-12-run-comparison-design.md, "Checkpoint steps").
 *
 * Attached to the browser context by the runner when the test has a network checkpoint, so it
 * sees every tab and every request from the first navigation on. Each checkpoint takes the
 * requests finished since the previous one. As with the HAR, no body goes into the checkpoint:
 * only its sha-256, taken after the checkpoint's mask, if it has one.
 *
 * Only what is the same on two environments is kept: the path and the query, not the host, so a
 * comparison of staging against production pairs the same call.
 */

/** Requests held between two checkpoints; beyond it the oldest go and the checkpoint says so. */
export const MAX_JOURNAL_PENDING = 5000;
/** A response larger than this is not hashed: comparing it would cost more than it tells. */
export const MAX_HASHED_RESPONSE_BYTES = 5 * 1024 * 1024;
/** How long a checkpoint waits for the requests still open when it runs. */
export const SETTLE_MS = 2000;

interface Recorded {
  url: string;
  resourceType: string;
  entry: NetworkCheckpointEntry;
  /** The request body, kept until the checkpoint so its mask can apply before the hash. */
  body: Buffer | null;
}

/** What replaces each part of a request body a checkpoint's mask matches. */
export const MASKED = '<masked>';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Method, path, sorted query, hashes and status of one finished (or failed) request. */
async function describeRequest(request: Request, failed: boolean): Promise<Recorded> {
  const url = new URL(request.url());
  const query = [...url.searchParams].map(([key, value]) => `${key}=${value}`).sort();
  const body = request.postDataBuffer();
  // A failed request may still have had its response: Chromium aborts the unread body of a
  // fetch the page dropped, and the status is what the server said.
  const response = await request.response().catch(() => null);
  const entry: NetworkCheckpointEntry = {
    method: request.method(),
    path: url.pathname,
    query,
    requestBodyHash: body && body.length > 0 ? sha256(body) : null,
    status: response?.status() ?? 0,
  };
  const type = request.resourceType();
  if (response && !failed && (type === 'fetch' || type === 'xhr')) {
    const length = Number(response.headers()['content-length'] ?? 0);
    if (!(length > MAX_HASHED_RESPONSE_BYTES)) {
      const responseBody = await response.body().catch(() => null);
      if (responseBody && responseBody.length <= MAX_HASHED_RESPONSE_BYTES)
        entry.responseBodyHash = sha256(responseBody);
    }
  }
  const kept = body && body.length > 0 && body.length <= MAX_HASHED_RESPONSE_BYTES ? body : null;
  return { url: request.url(), resourceType: type, entry, body: kept };
}

/** The entry with its request body hashed after the mask: a body too large to keep is not. */
function maskedEntry(recorded: Recorded, mask: RegExp | undefined): NetworkCheckpointEntry {
  if (!mask || !recorded.body) return recorded.entry;
  const masked = recorded.body.toString('utf8').replace(mask, MASKED);
  return { ...recorded.entry, requestBodyHash: sha256(masked) };
}

const entryKey = (e: NetworkCheckpointEntry) =>
  JSON.stringify([
    e.method,
    e.path,
    e.query,
    e.requestBodyHash,
    e.status,
    e.responseBodyHash ?? '',
  ]);

/** Request order is the network's, not the application's: entries are compared sorted. */
export function sortEntries(entries: NetworkCheckpointEntry[]): NetworkCheckpointEntry[] {
  return entries
    .map((entry) => ({ entry, key: entryKey(entry) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ entry }) => entry);
}

export class NetworkJournal {
  private pending: Promise<Recorded | null>[] = [];
  /** Requests sent and not finished yet: a checkpoint waits for them, up to SETTLE_MS. */
  private inFlight = new Map<Request, Promise<void>>();
  private settled = new Map<Request, () => void>();
  private dropped = 0;

  constructor(context: BrowserContext) {
    context.on('request', (request) => this.sent(request));
    context.on('requestfinished', (request) => this.record(request, false));
    context.on('requestfailed', (request) => this.record(request, true));
  }

  private sent(request: Request): void {
    // A data: or blob: URL is the page talking to itself, not to a server.
    if (!/^https?:/i.test(request.url())) return;
    this.inFlight.set(request, new Promise<void>((resolve) => this.settled.set(request, resolve)));
    // A request of a closed page may never settle: the oldest open one goes first.
    if (this.inFlight.size > MAX_JOURNAL_PENDING) {
      const oldest = this.inFlight.keys().next().value as Request;
      this.settled.get(oldest)?.();
      this.settled.delete(oldest);
      this.inFlight.delete(oldest);
    }
  }

  private record(request: Request, failed: boolean): void {
    if (!/^https?:/i.test(request.url())) return;
    const pending = describeRequest(request, failed).catch(() => null);
    this.pending.push(pending);
    if (this.pending.length > MAX_JOURNAL_PENDING) {
      this.pending.shift();
      this.dropped++;
    }
    // Settled once described, so a checkpoint waiting for it finds it among the pending.
    const resolve = this.settled.get(request);
    this.settled.delete(request);
    this.inFlight.delete(request);
    if (resolve) void pending.then(() => resolve());
  }

  /**
   * The requests finished since the previous checkpoint that match one of the patterns, sorted;
   * with no pattern, the page's fetch and XHR calls. A request still open waits up to SETTLE_MS
   * (a long poll never ends); one still open then goes to the next checkpoint. The journal starts
   * over after each take. A mask replaces what it matches in each request body before the hash,
   * so a value the application makes up on the spot (a time in a file name) compares equal.
   */
  async take(
    patterns: readonly string[],
    mask?: RegExp,
  ): Promise<{
    entries: NetworkCheckpointEntry[];
    /** Requests the journal could not hold since the previous checkpoint. */
    dropped: number;
  }> {
    if (this.inFlight.size > 0) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(this.inFlight.values()),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, SETTLE_MS))),
      ]);
      clearTimeout(timer);
    }
    const taken = this.pending;
    const dropped = this.dropped;
    this.pending = [];
    this.dropped = 0;
    const recorded = (await Promise.all(taken)).filter((r): r is Recorded => r !== null);
    const matchers = patterns.map(urlPatternMatcher);
    const wanted = recorded.filter((r) =>
      matchers.length === 0
        ? r.resourceType === 'fetch' || r.resourceType === 'xhr'
        : matchers.some((matches) => matches(r.url)),
    );
    return { entries: sortEntries(wanted.map((r) => maskedEntry(r, mask))), dropped };
  }
}

const journals = new WeakMap<BrowserContext, NetworkJournal>();

/** Whether a sequence has a network checkpoint, so the runner attaches a journal only then. */
export function hasNetworkCheckpoint(
  steps: readonly { action?: { id?: string } | null }[],
): boolean {
  return steps.some((step) => step.action?.id === 'checkpointNetwork');
}

/** Starts keeping the context's requests; a second call keeps the journal already there. */
export function attachNetworkJournal(context: BrowserContext): NetworkJournal {
  let journal = journals.get(context);
  if (!journal) {
    journal = new NetworkJournal(context);
    journals.set(context, journal);
  }
  return journal;
}

/** The context's journal, when the runner attached one. */
export function networkJournalOf(context: BrowserContext): NetworkJournal | undefined {
  return journals.get(context);
}

/**
 * The value of a `checkpointNetwork` step: `name`, `name | pattern[, pattern]` or
 * `name | pattern[, pattern] | mask`. The mask is a regular expression, everything after the
 * second `|` (it may hold a `|` of its own); with no pattern, `name | | mask`.
 */
export function parseNetworkCheckpointValue(
  raw: string,
): { name: string; patterns: string[]; mask?: RegExp } | { error: string } {
  const at = raw.indexOf('|');
  const name = (at < 0 ? raw : raw.slice(0, at)).trim();
  if (name === '') return { error: 'the name of the checkpoint comes first' };
  const rest = at < 0 ? '' : raw.slice(at + 1);
  const maskAt = rest.indexOf('|');
  const patterns = (maskAt < 0 ? rest : rest.slice(0, maskAt))
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (maskAt < 0) return { name, patterns };
  const source = rest.slice(maskAt + 1).trim();
  if (source === '') return { error: 'the mask after the second | is empty' };
  try {
    return { name, patterns, mask: new RegExp(source, 'g') };
  } catch (err) {
    return { error: `the mask is not a regular expression (${(err as Error).message})` };
  }
}
