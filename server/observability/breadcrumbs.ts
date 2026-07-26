const DEFAULT_MAX_CORRELATIONS = 500;
const DEFAULT_MAX_PER_CORRELATION = 50;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface Bucket {
  crumbs: Record<string, unknown>[];
  touchedAt: number;
}

/**
 * Bounded per-correlation trail of what happened before a failure.
 *
 * Every dimension is capped — number of correlations, crumbs per correlation, and age —
 * because an unbounded, non-expiring Map keyed by request id is a memory leak that only
 * shows up under load.
 */
export class BreadcrumbRing {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxCorrelations: number;
  private readonly maxPerCorrelation: number;
  private readonly ttlMs: number;

  constructor(options: { maxCorrelations?: number; maxPerCorrelation?: number; ttlMs?: number } = {}) {
    this.maxCorrelations = options.maxCorrelations ?? DEFAULT_MAX_CORRELATIONS;
    this.maxPerCorrelation = options.maxPerCorrelation ?? DEFAULT_MAX_PER_CORRELATION;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  push(correlationId: string, crumb: Record<string, unknown>): void {
    this.sweep();

    let bucket = this.buckets.get(correlationId);
    if (bucket) {
      // Re-insert so Map iteration order tracks recency, making the first key the LRU.
      this.buckets.delete(correlationId);
    } else {
      bucket = { crumbs: [], touchedAt: 0 };
    }

    bucket.crumbs.push(crumb);
    if (bucket.crumbs.length > this.maxPerCorrelation) {
      bucket.crumbs = bucket.crumbs.slice(-this.maxPerCorrelation);
    }
    bucket.touchedAt = Date.now();
    this.buckets.set(correlationId, bucket);

    while (this.buckets.size > this.maxCorrelations) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }
  }

  take(correlationId: string): Record<string, unknown>[] {
    this.sweep();
    return [...(this.buckets.get(correlationId)?.crumbs ?? [])];
  }

  size(): number {
    return this.buckets.size;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.touchedAt < cutoff) this.buckets.delete(key);
    }
  }
}

/** Shared instance used by the taps. */
export const serverBreadcrumbs = new BreadcrumbRing();
