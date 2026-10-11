import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

/**
 * The organization's projects, under the one key every screen shares.
 *
 * They were cached under both `['projects']` and `['/api/projects']`, each with its own
 * fetcher. With `staleTime: Infinity`, a project created in one dialog showed up in the
 * screens on its key and never in the others until a reload, because the invalidation only
 * ever named one of the two. One key, one fetcher: a consumer that wants a subset (the
 * projects a test can be saved into, say) filters what it renders, not what it caches.
 */

export interface ProjectSummary {
  id: number;
  name: string;
  userId: number;
  createdAt: string;
  /** Visible only to owners and the project's members. */
  restricted?: boolean;
  /** What the signed-in user may do in it. */
  access?: 'viewer' | 'editor' | 'owner' | null;
}

export const PROJECTS_QUERY_KEY = ['projects'] as const;

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await apiRequest('GET', '/api/projects');
  const data = await res.json();
  // An error object or a loosely parsed HTML page is not a list; an empty picker beats
  // `projects.map is not a function` taking the whole screen down.
  return Array.isArray(data) ? data : [];
}

export function useProjects(options: { enabled?: boolean } = {}) {
  return useQuery<ProjectSummary[], Error>({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: fetchProjects,
    enabled: options.enabled,
  });
}
