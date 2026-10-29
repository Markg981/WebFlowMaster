// Where to send someone after they sign in: the page a guard turned them away from.
// Only same-origin paths are accepted, so a crafted link cannot bounce them to another site.
const DEFAULT_TARGET = '/dashboard';

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/')) return DEFAULT_TARGET;
  // `//evil.com` and `/\evil.com` are read by browsers as protocol-relative URLs.
  if (value.startsWith('//') || value.startsWith('/\\') || /[\r\n\t]/.test(value)) {
    return DEFAULT_TARGET;
  }
  if (value === '/auth' || value.startsWith('/auth?') || value.startsWith('/auth/')) {
    return DEFAULT_TARGET;
  }
  return value;
}

export function loginUrlFor(path: string): string {
  const target = safeReturnTo(path);
  return target === DEFAULT_TARGET && path !== DEFAULT_TARGET
    ? '/auth'
    : `/auth?returnTo=${encodeURIComponent(target)}`;
}

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}
