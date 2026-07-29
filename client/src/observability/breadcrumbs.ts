const MAX_BREADCRUMBS = 50;

let ring: Record<string, unknown>[] = [];

/**
 * Bounded trail of what the user did. Distinct from the logger on purpose: logs are
 * continuous and land in the file a person reads, breadcrumbs stay in memory and travel
 * with an incident, so the seconds before a failure can be reconstructed without
 * scrolling a log.
 */
export function pushBreadcrumb(crumb: Record<string, unknown>): void {
  try {
    ring.push({ ts: new Date().toISOString(), ...crumb });
    if (ring.length > MAX_BREADCRUMBS) ring = ring.slice(-MAX_BREADCRUMBS);
  } catch {
    // A breadcrumb is never worth an exception.
  }
}

export function takeBreadcrumbs(): Record<string, unknown>[] {
  return [...ring];
}

export function __resetBreadcrumbs(): void {
  ring = [];
}
