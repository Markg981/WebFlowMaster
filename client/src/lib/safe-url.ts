/**
 * A URL that came from outside (a tracker, a CI system) is safe to use as a link only when it is
 * http or https: React does not block `javascript:` or `data:` hrefs. Returns the normalised URL,
 * or undefined so the anchor renders without an href.
 */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
