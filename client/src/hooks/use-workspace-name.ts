import { useQuery } from '@tanstack/react-query';

/**
 * What this installation calls itself, in the sidebar and the breadcrumb.
 *
 * AppShell.tsx used to say "DMO" in two places, written by hand — which made a product
 * meant to test any web application present itself as the tool of a single customer. The
 * value is a system setting, so one deployment can be "DMO" and the next something else
 * without a rebuild.
 */

export const DEFAULT_WORKSPACE_NAME = 'WebFlowMaster';

export function useWorkspaceName(): string {
  const { data } = useQuery({
    queryKey: ['systemSetting', 'workspaceName'],
    queryFn: async () => {
      const res = await fetch('/api/system-settings/workspaceName', { credentials: 'include' });
      if (!res.ok) return null;
      const setting = await res.json();
      return typeof setting?.value === 'string' && setting.value.trim() !== ''
        ? setting.value.trim()
        : null;
    },
    // It changes about as often as the deployment does, and every page renders it.
    staleTime: Infinity,
    retry: false,
  });

  return data ?? DEFAULT_WORKSPACE_NAME;
}
