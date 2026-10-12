import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

/**
 * The organization's tags with how many tests carry each, under the one key every screen
 * shares. See use-projects.ts for why there is exactly one key.
 */

export interface TagSummary {
  id: string;
  name: string;
  createdAt?: string;
  uiCount: number;
  apiCount: number;
  mobileCount: number;
}

export const TAGS_QUERY_KEY = ['tags'] as const;

export async function fetchTags(): Promise<TagSummary[]> {
  const res = await apiRequest('GET', '/api/tags');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function useTags(options: { enabled?: boolean } = {}) {
  return useQuery<TagSummary[], Error>({
    queryKey: TAGS_QUERY_KEY,
    queryFn: fetchTags,
    enabled: options.enabled,
  });
}
