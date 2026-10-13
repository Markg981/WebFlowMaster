import type { SessionUser } from '@/hooks/use-auth';
import { queryClient } from './queryClient';

/**
 * The one way the client changes whose session it is.
 *
 * Everything in the query cache was fetched as the person signed in at the time, and most keys
 * are bare URLs with `staleTime: Infinity`: kept across a sign-out, the next person in the same
 * tab would be shown the previous one's tests from memory, without a request the server could
 * refuse. So signing in, the second factor, registering, signing out, an ended session and an
 * organization switch all come through here, and the whole cache goes before the new user is set.
 *
 * `clear()` also cancels requests still in flight: a response for the previous person that
 * arrives after the switch lands on a query that is no longer in the cache, not on the screen.
 */
export function replaceSession(user: SessionUser | null): void {
  queryClient.clear();
  queryClient.setQueryData(['/api/user'], user);
}
