import type { BrowserContext, Request } from 'playwright';

/**
 * The requests a browser context has in flight, for the `waitForNetworkIdle` step.
 *
 * Playwright's `networkidle` is a navigation milestone: once the page has reached it, waiting
 * for it again returns at once. So after a click that starts an XHR, the step used to pass
 * before the call answered, and a network checkpoint right after it put a slow call (a report
 * query over many machines) in the next checkpoint on one run and in this one on the other.
 */

/** A request open longer than this is taken for a long poll and no longer waited for. */
export const LONG_POLL_MS = 60_000;

/** How long the context must have nothing in flight to count as idle, as Playwright's own. */
export const NETWORK_QUIET_MS = 500;

/** Longest a `waitForNetworkIdle` step waits for the calls an action started to answer. */
export const NETWORK_IDLE_TIMEOUT_MS = 60_000;

/** Static files are left out: a page waiting on an image is not waiting on its data. */
const AWAITED_TYPES = new Set(['document', 'xhr', 'fetch', 'script', 'stylesheet']);

export interface NetworkActivity {
  /** Requests open now, long polls excluded. */
  pending(): number;
  /** When a request last started or ended. */
  lastActivityAt(): number;
}

/** What the tracker listens to of a context, so a test can stand in for it. */
export interface RequestEventSource {
  on(
    event: 'request' | 'requestfinished' | 'requestfailed',
    listener: (request: Request) => void,
  ): unknown;
}

export function trackNetworkActivity(
  source: RequestEventSource,
  now: () => number = Date.now,
): NetworkActivity {
  const started = new Map<Request, number>();
  let last = now();
  source.on('request', (request) => {
    if (!/^https?:/i.test(request.url())) return;
    if (!AWAITED_TYPES.has(request.resourceType())) return;
    started.set(request, now());
    last = now();
  });
  const done = (request: Request) => {
    if (started.delete(request)) last = now();
  };
  source.on('requestfinished', done);
  source.on('requestfailed', done);
  return {
    pending() {
      const limit = now() - LONG_POLL_MS;
      let open = 0;
      for (const at of started.values()) if (at > limit) open += 1;
      return open;
    },
    lastActivityAt: () => last,
  };
}

const trackers = new WeakMap<BrowserContext, NetworkActivity>();

/** The context's tracker, started on first use; the step executor starts it on the first step. */
export function networkActivityOf(context: BrowserContext): NetworkActivity {
  let tracker = trackers.get(context);
  if (!tracker) {
    tracker = trackNetworkActivity(context);
    trackers.set(context, tracker);
  }
  return tracker;
}

/**
 * Resolves true once nothing has been in flight for `quietMs`, false at the deadline. A call
 * the application starts shortly after the previous one answered (a digest, a debounce) resets
 * the quiet period instead of being left to the next step.
 */
export async function waitForQuietNetwork(
  activity: NetworkActivity,
  deadline: number,
  quietMs: number = NETWORK_QUIET_MS,
  now: () => number = Date.now,
): Promise<boolean> {
  for (;;) {
    const at = now();
    if (activity.pending() === 0 && at - activity.lastActivityAt() >= quietMs) return true;
    if (at >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
