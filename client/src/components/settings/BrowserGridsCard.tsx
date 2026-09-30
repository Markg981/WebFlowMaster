import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Cloud, Loader2, PlugZap, Trash2 } from 'lucide-react';
import {
  BROWSER_GRID_LABELS,
  BROWSER_GRID_PROVIDERS,
  GRID_FIELDS,
  LOCAL_APPIUM_DEFAULT_URL,
  endpointProblem,
  type BrowserGridProvider,
} from '@shared/browser-grids';

/**
 * Where plans can borrow browsers the runners do not have: BrowserStack, LambdaTest, or a
 * Playwright server of the organization's own (shared/browser-grids.ts). And where mobile app tests
 * find devices: the two clouds, or an Appium next to a local agent.
 *
 * The access key is written once and never read back, as an issue tracker's token.
 */

export interface BrowserGridSummary {
  id: string;
  name: string;
  provider: BrowserGridProvider;
  username: string | null;
  endpoint: string | null;
  agentPool?: string | null;
  hasKey: boolean;
}

const BrowserGridsCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<BrowserGridProvider>('browserstack');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [key, setKey] = useState('');
  const [agentPool, setAgentPool] = useState('');
  const [formError, setFormError] = useState('');
  const [checked, setChecked] = useState<{ ok: boolean; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const fields = GRID_FIELDS[provider];
  const isAppium = provider === 'local_appium';

  // The pools the organization's agents are in, offered for a local Appium.
  const { data: agents = [] } = useQuery<Array<{ pool: string }>>({
    queryKey: ['agents'],
    queryFn: async () => {
      const response = await fetch('/api/agents');
      return response.ok ? response.json() : [];
    },
    enabled: isAppium,
  });
  const pools = Array.from(new Set((Array.isArray(agents) ? agents : []).map((agent) => agent.pool).filter(Boolean)));

  const { data: grids = [], isLoading, error } = useQuery<BrowserGridSummary[]>({
    queryKey: ['browserGrids'],
    queryFn: async () => {
      const response = await fetch('/api/browser-grids');
      if (!response.ok) throw new Error(t('browserGrids.loadFailed', 'Could not load the browser grids.'));
      return response.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/browser-grids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          username: fields.username ? username.trim() : null,
          endpoint: fields.endpoint ? endpoint.trim() || null : null,
          agentPool: fields.agentPool ? agentPool.trim() : null,
          key: fields.key === 'none' ? null : key.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('browserGrids.saveFailed', 'Could not save the grid.'));
      return body as BrowserGridSummary;
    },
    onSuccess: () => {
      setName('');
      setUsername('');
      setEndpoint('');
      setKey('');
      setAgentPool('');
      setFormError('');
      queryClient.invalidateQueries({ queryKey: ['browserGrids'] });
    },
    onError: (mutationError: Error) => setFormError(mutationError.message),
  });

  const check = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/browser-grids/${id}/test`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('browserGrids.checkFailed', 'Could not check the grid.'));
      return body as { ok: boolean; message: string };
    },
    onMutate: () => setChecked(null),
    onSuccess: (result) => setChecked(result),
    onError: (checkError: Error) => setChecked({ ok: false, message: checkError.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/browser-grids/${id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('browserGrids.deleteFailed', 'Could not delete the grid.'));
      return body as { plansMovedToRunners: number };
    },
    onSuccess: (result) => {
      setNotice(
        result.plansMovedToRunners > 0
          ? t('browserGrids.deleted', '{{count}} plan(s) that used it run on the server’s runners again.', { count: result.plansMovedToRunners })
          : '',
      );
      queryClient.invalidateQueries({ queryKey: ['browserGrids'] });
    },
    onError: (removeError: Error) => setNotice(removeError.message),
  });

  const submit = () => {
    if (!name.trim()) return setFormError(t('browserGrids.nameRequired', 'A name is required.'));
    if (fields.username && !username.trim()) return setFormError(t('browserGrids.usernameRequired', 'A username is required for this provider.'));
    if (fields.endpointRequired && !endpoint.trim()) {
      return setFormError(t('browserGrids.endpointRequired', 'The address of a Playwright server starts with ws:// or wss://.'));
    }
    if (fields.endpoint && endpoint.trim() && endpointProblem(provider, endpoint.trim())) {
      return setFormError(
        isAppium
          ? t('browserGrids.appiumEndpointInvalid', "Appium's address starts with http:// or https://, as the agent's machine reaches it.")
          : t('browserGrids.endpointRequired', 'The address of a Playwright server starts with ws:// or wss://.'),
      );
    }
    if (fields.agentPool && !agentPool.trim()) return setFormError(t('browserGrids.poolRequired', 'Name the pool of local agents that reach Appium.'));
    if (fields.key === 'required' && !key.trim()) return setFormError(t('browserGrids.keyRequired', 'An access key is required for this provider.'));
    setFormError('');
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Cloud className="h-4 w-4 text-muted-foreground" />
          <span>{t('browserGrids.title', 'Browser grids')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'browserGrids.description',
            'Browsers the runners do not have — Windows and macOS, branded Chrome and Edge, older versions — borrowed from BrowserStack, LambdaTest or a Playwright server of your own. A plan picks one in its run settings.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="gridProvider">{t('browserGrids.provider', 'Provider')}</Label>
            <Select value={provider} onValueChange={(value) => setProvider(value as BrowserGridProvider)}>
              <SelectTrigger id="gridProvider" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROWSER_GRID_PROVIDERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {BROWSER_GRID_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="gridName">{t('browserGrids.name', 'Name')}</Label>
            <Input id="gridName" className="mt-1" value={name} onChange={(event) => setName(event.target.value)} placeholder={BROWSER_GRID_LABELS[provider]} />
          </div>
          {fields.username && (
            <div>
              <Label htmlFor="gridUsername">{t('browserGrids.username', 'Username')}</Label>
              <Input id="gridUsername" className="mt-1" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
            </div>
          )}
          {fields.endpoint && (
            <div className="md:col-span-2">
              <Label htmlFor="gridEndpoint">{t('browserGrids.endpoint', 'Address')}</Label>
              <Input
                id="gridEndpoint"
                className="mt-1 font-mono text-xs"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder={isAppium ? LOCAL_APPIUM_DEFAULT_URL : 'wss://grid.example.com/playwright?token={token}'}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isAppium
                  ? t('browserGrids.appiumEndpointHint', "Appium's address as the agent's machine reaches it. Empty: {{url}}, where Appium listens when started with no options.", { url: LOCAL_APPIUM_DEFAULT_URL })
                  : t('browserGrids.endpointHint', 'Where {token} appears, the token goes there; otherwise it is sent as a bearer token. The server must run the same Playwright version as the runners.')}
              </p>
            </div>
          )}
          {fields.agentPool && (
            <div className="md:col-span-2">
              <Label htmlFor="gridPool">{t('browserGrids.agentPool', 'Pool of local agents')}</Label>
              <Input id="gridPool" className="mt-1" list="gridPools" value={agentPool} onChange={(event) => setAgentPool(event.target.value)} placeholder="default" />
              <datalist id="gridPools">
                {pools.map((pool) => (
                  <option key={pool} value={pool} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground mt-1">
                {t('browserGrids.agentPoolHint', 'An agent of this pool, on the machine next to Appium, carries the requests: the server needs no way into that network.')}
              </p>
            </div>
          )}
          {fields.key !== 'none' && (
          <div className={fields.endpoint ? 'md:col-span-2' : ''}>
            <Label htmlFor="gridKey">
              {fields.key === 'required' ? t('browserGrids.accessKey', 'Access key') : t('browserGrids.token', 'Token (optional)')}
            </Label>
            <Input id="gridKey" className="mt-1" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground mt-1">
              {t('browserGrids.keyHint', 'Stored encrypted and never shown again.')}
            </p>
          </div>
          )}
        </div>

        {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
        <Button onClick={submit} disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('browserGrids.add', 'Add grid')}
        </Button>

        {check.isPending && (
          <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('browserGrids.checking', 'Opening a browser on the grid…')}
          </p>
        )}
        {checked && <p className={`text-sm ${checked.ok ? 'text-green-600' : 'text-destructive'}`} role="status">{checked.message}</p>}
        {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('browserGrids.loading', 'Loading…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : grids.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('browserGrids.empty', 'No grid yet: plans run on the server’s runners or on local agents.')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('browserGrids.columns.name', 'Name')}</TableHead>
                <TableHead>{t('browserGrids.columns.account', 'Account or address')}</TableHead>
                <TableHead className="text-right">{t('browserGrids.columns.actions', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grids.map((grid) => (
                <TableRow key={grid.id}>
                  <TableCell className="font-medium">
                    {grid.name}
                    <Badge variant="secondary" className="ml-2 font-normal">{BROWSER_GRID_LABELS[grid.provider] ?? grid.provider}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground break-all">{grid.provider === 'local_appium' ? `${grid.agentPool ?? '—'} · ${grid.endpoint ?? LOCAL_APPIUM_DEFAULT_URL}` : grid.username ?? grid.endpoint ?? '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => check.mutate(grid.id)} disabled={check.isPending} title={t('browserGrids.check', 'Test connection')} aria-label={t('browserGrids.check', 'Test connection')}>
                      <PlugZap className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(grid.id)} disabled={remove.isPending} title={t('browserGrids.delete', 'Delete')} aria-label={t('browserGrids.delete', 'Delete')}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default BrowserGridsCard;
