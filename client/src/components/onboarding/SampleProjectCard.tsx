import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Store } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';

/**
 * "Start with a sample project", on the dashboard of an organization that has no tests yet.
 *
 * One click creates the Northwind Shop sample (server/authoring/sample-project.ts) — web and API
 * tests against a storefront the server itself serves, and plans that run them — and starts its
 * first plan, then opens that run's report: a new organization sees a real run within a minute
 * instead of an empty dashboard. The server decides whether to offer it (GET /api/sample-project);
 * "Not now" hides it for this person, in this browser.
 */

type Created = {
  plans: { id: string; name: string }[];
  firstRunPlanId: string;
  run: { id: string } | null;
  runError?: string;
};

const dismissedKey = (organizationId: number | undefined) =>
  `wfm.sampleProject.dismissed.${organizationId ?? 'none'}`;

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export default function SampleProjectCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const cache = useQueryClient();
  const key = dismissedKey(user?.organizationId);
  const [dismissed, setDismissed] = useState(() => readDismissed(key));
  const canCreate = user?.role === 'editor' || user?.role === 'owner';

  const offer = useQuery<{ offered: boolean }>({
    queryKey: ['sample-project', user?.organizationId],
    enabled: !!user && canCreate && !dismissed,
    queryFn: async () => (await apiRequest('GET', '/api/sample-project')).json(),
  });

  const create = useMutation({
    mutationFn: async (): Promise<Created> =>
      (await apiRequest('POST', '/api/sample-project', {})).json(),
    onSuccess: async (created) => {
      await cache.invalidateQueries();
      if (created.run) {
        toast({
          title: t('sampleProject.created', 'Sample project created'),
          description: t('sampleProject.running', 'Its first plan is running: here is its report.'),
        });
        navigate(`/test-plans/${created.firstRunPlanId}/executions/${created.run.id}/report`);
      } else {
        toast({
          title: t('sampleProject.created', 'Sample project created'),
          description: t('sampleProject.notStarted', 'Its first run did not start: {{reason}}', {
            reason: created.runError ?? '',
          }),
        });
        navigate('/test-plans');
      }
    },
  });

  if (!canCreate || dismissed || !offer.data?.offered) return null;

  const notNow = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Private mode: hidden until the page is reloaded, which is all "not now" promises.
    }
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby="sample-project-title"
      className="flex flex-col gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-center"
    >
      <div className="rounded-full bg-muted p-3 self-start">
        <Store className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h2 id="sample-project-title" className="font-medium">
          {t('sampleProject.title', 'Start with a sample project')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'sampleProject.description',
            'Web and API tests against a demo shop this server hosts, with plans that run them. The first plan starts right away, so you can open a real report in a minute. Delete it whenever you like.',
          )}
        </p>
        {create.isError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {(create.error as Error).message ||
              t('sampleProject.failed', 'The sample project could not be created.')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending
            ? t('sampleProject.creating', 'Creating…')
            : t('sampleProject.create', 'Create sample project')}
        </Button>
        <Button variant="ghost" onClick={notNow} disabled={create.isPending}>
          {t('sampleProject.notNow', 'Not now')}
        </Button>
      </div>
    </section>
  );
}
