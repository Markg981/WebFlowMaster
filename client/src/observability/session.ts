const SESSION_KEY = 'wfm:sessionId';

// Tracing ids, not credentials, but drawn from the platform CSPRNG anyway: getRandomValues works
// outside secure contexts too (plain-HTTP installations), unlike crypto.randomUUID.
const randomId = (prefix: string): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

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
