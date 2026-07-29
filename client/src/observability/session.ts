const SESSION_KEY = 'wfm:sessionId';

const randomId = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * One id per browser tab, surviving reloads within the tab. Used to stitch a whole user
 * journey together across separate actions.
 */
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = randomId('s');
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    // Private mode or storage disabled: an in-memory id is still better than none.
    return randomId('s');
  }
}

/**
 * One id per user action / API call. Sent as X-Correlation-Id, which the server's
 * correlation middleware adopts, so a UI action and the server work it triggers share
 * one id.
 */
export function newCorrelationId(): string {
  return randomId('c');
}
