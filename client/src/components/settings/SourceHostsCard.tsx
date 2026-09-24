import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { GitCommitHorizontal, Loader2 } from 'lucide-react';

type Provider = 'github' | 'gitlab';

/** A source host as GET /api/source-hosts returns it: never its token. */
export interface SourceHostSummary {
  provider: Provider;
  apiUrl: string;
  createdAt: string;
  updatedAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryError: string | null;
}

const PROVIDERS: Array<{ id: Provider; name: string; apiPlaceholder: string; tokenHint: string }> = [
  {
    id: 'github',
    name: 'GitHub',
    apiPlaceholder: 'https://api.github.com',
    tokenHint: 'A fine-grained token with "Commit statuses: read and write" on the repositories, or a classic one with repo:status.',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    apiPlaceholder: 'https://gitlab.com/api/v4',
    tokenHint: 'A project, group or personal access token with the api scope, from a member with at least the Developer role.',
  },
];

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body.error || fallback;
}

/**
 * Where a run started from CI reports its result: the commit it tested, next to the other checks.
 *
 * One GitHub and one GitLab per organization. The server checks a token before keeping it and
 * never sends it back; what this card shows is whether each is connected and whether the last
 * status got through — the answer to "why is there no check on my pull request?".
 */
const SourceHostsCard: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Provider | null>(null);
  const [apiUrl, setApiUrl] = useState('');
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState('');
  const [checked, setChecked] = useState<Partial<Record<Provider, string>>>({});

  const { data: hosts = [], isLoading } = useQuery<SourceHostSummary[]>({
    queryKey: ['sourceHosts'],
    queryFn: async () => {
      const response = await fetch('/api/source-hosts');
      if (!response.ok) throw new Error('Could not load the source hosts');
      return response.json();
    },
  });

  const connect = useMutation({
    mutationFn: async (provider: Provider) => {
      const response = await fetch(`/api/source-hosts/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: apiUrl.trim(), token: token.trim() }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not connect'));
      return response.json() as Promise<SourceHostSummary & { account: string }>;
    },
    onSuccess: (saved) => {
      setChecked((previous) => ({ ...previous, [saved.provider]: t('settings.sourceHosts.authenticatesAs', 'Connected as {{account}}', { account: saved.account }) }));
      setEditing(null);
      setToken('');
      queryClient.invalidateQueries({ queryKey: ['sourceHosts'] });
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const test = useMutation({
    mutationFn: async (provider: Provider) => {
      const response = await fetch(`/api/source-hosts/${provider}/test`, { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response, 'Could not check'));
      return { provider, result: (await response.json()) as { ok: boolean; account?: string; error?: string } };
    },
    onSuccess: ({ provider, result }) =>
      setChecked((previous) => ({
        ...previous,
        [provider]: result.ok ? t('settings.sourceHosts.authenticatesAs', 'Connected as {{account}}', { account: result.account }) : result.error,
      })),
  });

  const remove = useMutation({
    mutationFn: async (provider: Provider) => {
      const response = await fetch(`/api/source-hosts/${provider}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response, 'Could not remove'));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sourceHosts'] }),
  });

  const startEditing = (provider: Provider, current?: SourceHostSummary) => {
    setEditing(provider);
    setApiUrl(current && current.apiUrl !== PROVIDERS.find((p) => p.id === provider)!.apiPlaceholder ? current.apiUrl : '');
    setToken('');
    setFormError('');
  };

  const handleConnect = (provider: Provider) => {
    if (token.trim() === '') {
      setFormError(t('settings.sourceHosts.tokenRequired', 'Paste a token.'));
      return;
    }
    setFormError('');
    connect.mutate(provider);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.sourceHosts.title', 'Commit status')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.sourceHosts.description',
            'A run started from GitHub Actions or GitLab CI shows on the commit it tested: pending while it runs, then passed or failed, with a link to the report.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('settings.sourceHosts.loading', 'Loading…')}</p>
        ) : (
          PROVIDERS.map((provider) => {
            const host = hosts.find((h) => h.provider === provider.id);
            return (
              <div key={provider.id} className="border rounded-md p-3 space-y-2" data-testid={`source-host-${provider.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{provider.name}</span>
                    <Badge variant={host ? 'default' : 'secondary'} className="ml-2">
                      {host ? t('settings.sourceHosts.connected', 'connected') : t('settings.sourceHosts.notConnected', 'not connected')}
                    </Badge>
                    {host && <span className="ml-2 text-xs text-muted-foreground">{host.apiUrl}</span>}
                  </div>
                  {isOwner && editing !== provider.id && (
                    <div className="flex gap-2">
                      {host && (
                        <Button size="sm" variant="outline" onClick={() => test.mutate(provider.id)} disabled={test.isPending}>
                          {t('settings.sourceHosts.test', 'Test')}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => startEditing(provider.id, host)}>
                        {host ? t('settings.sourceHosts.replace', 'Replace token') : t('settings.sourceHosts.connect', 'Connect')}
                      </Button>
                      {host && (
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(provider.id)} disabled={remove.isPending}>
                          {t('settings.sourceHosts.remove', 'Disconnect')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {host && (
                  <p className={`text-xs ${host.lastDeliveryError ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {host.lastDeliveryError
                      ? t('settings.sourceHosts.lastFailed', 'The last status was not set: {{error}}', { error: host.lastDeliveryError })
                      : host.lastDeliveryAt
                        ? t('settings.sourceHosts.lastDelivered', 'Last status set {{when}}.', { when: new Date(host.lastDeliveryAt).toLocaleString() })
                        : t('settings.sourceHosts.noneYet', 'No status sent yet: the next run started from a pipeline will send one.')}
                  </p>
                )}
                {checked[provider.id] && <p className="text-xs">{checked[provider.id]}</p>}

                {editing === provider.id && (
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor={`${provider.id}-api`}>{t('settings.sourceHosts.apiUrl', 'API URL (only for a self-hosted server)')}</Label>
                      <Input id={`${provider.id}-api`} value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder={provider.apiPlaceholder} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor={`${provider.id}-token`}>{t('settings.sourceHosts.token', 'Token')}</Label>
                      <Input id={`${provider.id}-token`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="mt-1" />
                      <p className="text-xs text-muted-foreground mt-1">
                        {provider.id === 'github'
                          ? t('settings.sourceHosts.githubTokenHint', provider.tokenHint)
                          : t('settings.sourceHosts.gitlabTokenHint', provider.tokenHint)}
                      </p>
                    </div>
                    {formError && <p className="text-sm text-destructive">{formError}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleConnect(provider.id)} disabled={connect.isPending}>
                        {connect.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        {t('settings.sourceHosts.save', 'Check and save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        {t('common.cancel', 'Cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            'settings.sourceHosts.footnote',
            'The CLI sends the repository and commit by itself when it runs in GitHub Actions or GitLab CI. The status links to the report when WEBFLOW_PUBLIC_URL is set on the server.',
          )}
        </p>
      </CardContent>
    </Card>
  );
};

export default SourceHostsCard;
