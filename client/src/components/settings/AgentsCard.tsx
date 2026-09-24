import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Copy, Laptop, Loader2, Trash2 } from 'lucide-react';

/** An agent as GET /api/agents returns it: never its token. */
export interface AgentSummary {
  id: string;
  name: string;
  pool: string;
  tokenPrefix: string;
  createdAt: string;
  lastSeenAt: string | null;
  hostname: string | null;
  agentVersion: string | null;
  playwrightVersion: string | null;
  browsers: string[];
  revokedAt: string | null;
  connected: boolean;
  activeSessions: number;
}

export interface AgentsResponse {
  agents: AgentSummary[];
  serverPlaywrightVersion: string;
}

export const agentsQueryKey = ['agents'];

export async function fetchAgents(): Promise<AgentsResponse> {
  const response = await fetch('/api/agents');
  if (!response.ok) throw new Error('Could not load the agents');
  return response.json();
}

/**
 * Local agents: machines inside a network the server cannot reach, lending it their browsers.
 *
 * Everyone sees which exist and which are connected, because a plan's "run on" names a pool of
 * them. Only an owner creates or revokes one — the server enforces that; this card just does not
 * offer it to anyone else. The token is shown once, with what to run on the machine.
 */
const AgentsCard: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [pool, setPool] = useState('default');
  const [formError, setFormError] = useState('');
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);

  const { data, isLoading, error } = useQuery<AgentsResponse>({
    queryKey: agentsQueryKey,
    queryFn: fetchAgents,
    refetchInterval: 15_000,
  });
  const agents = (data?.agents ?? []).filter((agent) => !agent.revokedAt);

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), pool: pool.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = body.details?.fieldErrors?.pool?.[0];
        throw new Error(detail || body.error || 'Could not create the agent');
      }
      return response.json() as Promise<{ agent: AgentSummary; token: string }>;
    },
    onSuccess: (created) => {
      setIssued({ token: created.token, name: created.agent.name });
      setName('');
      queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
    onError: (mutationError: Error) => setFormError(mutationError.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/agents/${id}/revoke`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not revoke the agent');
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agentsQueryKey }),
  });

  const handleCreate = () => {
    if (name.trim() === '') {
      setFormError(t('settings.agents.nameRequired', 'Give the agent a name, such as the machine it runs on.'));
      return;
    }
    setFormError('');
    create.mutate();
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const playwrightVersion = data?.serverPlaywrightVersion ?? 'latest';
  const setup = issued
    ? [
        `curl -fsSL ${origin}/cli/wfm-agent.mjs -o wfm-agent.mjs`,
        `npm install playwright@${playwrightVersion} ws && npx playwright install chromium`,
        `WFM_URL=${origin} WFM_AGENT_TOKEN=${issued.token} node wfm-agent.mjs`,
      ].join('\n')
    : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Laptop className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.agents.title', 'Local agents')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.agents.description',
            'A local agent runs inside your network and lends its browsers to the plans set to run on its pool, so they can test applications this server cannot reach. It only connects out.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isOwner && (
          <>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <Label htmlFor="agentName">{t('settings.agents.nameLabel', 'Name')}</Label>
                <Input id="agentName" value={name} onChange={(e) => setName(e.target.value)} placeholder="QA build box" className="mt-1" />
              </div>
              <div className="w-full sm:w-40">
                <Label htmlFor="agentPool">{t('settings.agents.poolLabel', 'Pool')}</Label>
                <Input id="agentPool" value={pool} onChange={(e) => setPool(e.target.value)} className="mt-1" />
              </div>
              <Button onClick={handleCreate} disabled={create.isPending}>
                {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('settings.agents.create', 'Create agent')}
              </Button>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </>
        )}

        {issued && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2" data-testid="agent-token">
            <p className="text-sm font-medium">
              {t('settings.agents.tokenOnce', 'The token for {{name}}. Copy it now: it will not be shown again.', { name: issued.name })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('settings.agents.setupHint', 'On the machine, with Node 20 or later:')}
            </p>
            <pre className="text-xs bg-background border rounded p-2 overflow-x-auto whitespace-pre">{setup}</pre>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(setup)}>
                <Copy className="h-3 w-3 mr-1" />
                {t('settings.agents.copy', 'Copy')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                {t('settings.agents.done', 'Done')}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('settings.agents.loading', 'Loading agents…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.agents.empty', 'No agents yet.')}</p>
        ) : (
          <ul className="space-y-2">
            {agents.map((agent) => {
              const mismatch =
                agent.playwrightVersion && data && agent.playwrightVersion.split('.').slice(0, 2).join('.') !== data.serverPlaywrightVersion.split('.').slice(0, 2).join('.');
              return (
                <li key={agent.id} className="flex items-center justify-between p-2 border rounded-md" data-testid={`agent-${agent.id}`}>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="font-medium">{agent.name}</span>
                      <Badge variant="outline" className="ml-2">
                        {t('settings.agents.pool', 'pool {{pool}}', { pool: agent.pool })}
                      </Badge>
                      <Badge variant={agent.connected ? 'default' : 'secondary'} className="ml-2">
                        {agent.connected ? t('settings.agents.connected', 'connected') : t('settings.agents.offline', 'offline')}
                      </Badge>
                      {agent.connected && agent.activeSessions > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          {t('settings.agents.sessions', '{{count}} browser(s) lent', { count: agent.activeSessions })}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        agent.hostname,
                        agent.playwrightVersion && `Playwright ${agent.playwrightVersion}`,
                        agent.browsers.length > 0 && agent.browsers.join(', '),
                        `${agent.tokenPrefix}…`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {!agent.lastSeenAt && ` · ${t('settings.agents.neverSeen', 'never connected')}`}
                    </div>
                    {mismatch && (
                      <p className="text-xs text-destructive">
                        {t('settings.agents.versionMismatch', 'Runs Playwright {{agent}}, the server {{server}}: it will not be lent browsers until they match.', {
                          agent: agent.playwrightVersion,
                          server: data!.serverPlaywrightVersion,
                        })}
                      </p>
                    )}
                  </div>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke.mutate(agent.id)}
                      disabled={revoke.isPending}
                      aria-label={t('settings.agents.revokeAction', 'Revoke {{name}}', { name: agent.name })}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default AgentsCard;
