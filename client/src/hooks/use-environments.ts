import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

/**
 * The environments this organization has, for the screens that let you pick one.
 *
 * An environment supplies the `{{variables}}` and secrets a test resolves against, and the
 * saved browser session it starts from. Three screens need the same list, and each had been
 * fetching it — or, more often, not offering the choice at all — on its own.
 */

export interface EnvironmentSummary {
  id: number;
  name: string;
  description: string | null;
  /** When a browser session was last captured for it, if ever. */
  loginStateCapturedAt: string | null;
}

/** The value the select uses for "resolve against the defaults only". */
export const NO_ENVIRONMENT = 'none';

export function useEnvironments() {
  return useQuery<EnvironmentSummary[]>({
    queryKey: ['environments'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/environments');
      const data = await res.json();
      // Anything but a list means the endpoint answered with something unexpected — an
      // error object, or an HTML error page parsed loosely. Rendering an empty picker beats
      // taking the whole page down with `environments.map is not a function`.
      return Array.isArray(data) ? data : [];
    },
  });
}

/** Turns the select's value into what the API expects, which is a number or nothing. */
export function environmentIdFor(selected: string): number | undefined {
  if (!selected || selected === NO_ENVIRONMENT) return undefined;
  const id = Number(selected);
  return Number.isInteger(id) ? id : undefined;
}
