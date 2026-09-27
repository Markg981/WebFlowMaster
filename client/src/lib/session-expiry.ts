import { queryClient } from './queryClient';

/**
 * Noticing that the server has ended this session.
 *
 * A session can end without the page asking: an owner makes single sign-on mandatory
 * (server/middleware/require-sso.ts), removes the member, or the session simply expires. The next
 * request answers 401, but many pages call fetch themselves and only show their own error, so the
 * app would stay on a page it can no longer load. Every /api response passes through here instead,
 * and a 401 while someone is signed in clears the signed-in user: ProtectedRoute then sends them to
 * /auth, where the sign-in form (and for SSO, its explanation) is.
 */
export function watchForEndedSession(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (response.status === 401 && isApiRequest(args[0]) && queryClient.getQueryData(['/api/user'])) {
      queryClient.setQueryData(['/api/user'], null);
    }
    return response;
  };
}

function isApiRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}
