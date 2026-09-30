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
import { ClipboardList, ListChecks, Loader2, PlugZap, Trash2 } from 'lucide-react';
import {
  PROVIDER_FIELDS,
  PROVIDER_LABELS,
  TEST_MANAGEMENT_PROVIDERS,
  type TestManagementProvider,
} from '@shared/test-management';
import TestCasesDialog from './TestCasesDialog';

/**
 * TestRail, Xray and Zephyr Scale: where finished runs are published (shared/test-management.ts).
 * A plan picks one in its run settings; each test says which case it is there.
 *
 * The token is written once and never read back, as an issue tracker's.
 */

export interface TestManagementSummary {
  id: string;
  name: string;
  provider: TestManagementProvider;
  baseUrl: string;
  username: string | null;
  projectKey: string;
  suiteId: string | null;
  testPlanKey: string | null;
  hasToken: boolean;
}

const TestManagementCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<TestManagementProvider>('testrail');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [suiteId, setSuiteId] = useState('');
  const [testPlanKey, setTestPlanKey] = useState('');
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState('');
  const [checked, setChecked] = useState<{ ok: boolean; detail: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [mapping, setMapping] = useState<TestManagementSummary | null>(null);
  const fields = PROVIDER_FIELDS[provider];

  const labels = {
    username: provider === 'xray_cloud' ? t('testManagement.clientId', 'Client id') : provider === 'testrail' ? t('testManagement.user', 'User (e-mail)') : t('testManagement.userOptional', 'User (only for a password)'),
    token:
      provider === 'xray_cloud'
        ? t('testManagement.clientSecret', 'Client secret')
        : provider === 'xray_server'
          ? t('testManagement.patOrPassword', 'Personal access token, or password')
          : t('testManagement.apiToken', 'API token'),
    project: fields.projectIsNumber ? t('testManagement.projectId', 'Project id (a number)') : t('testManagement.projectKey', 'Jira project key'),
  };

  const { data: connections = [], isLoading, error } = useQuery<TestManagementSummary[]>({
    queryKey: ['testManagement'],
    queryFn: async () => {
      const response = await fetch('/api/test-management');
      if (!response.ok) throw new Error(t('testManagement.loadFailed', 'Could not load the connections.'));
      return response.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/test-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          baseUrl: baseUrl.trim() || null,
          username: fields.username === 'none' ? null : username.trim() || null,
          projectKey: projectKey.trim(),
          suiteId: fields.suite ? suiteId.trim() || null : null,
          testPlanKey: fields.testPlan ? testPlanKey.trim() || null : null,
          token: token.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('testManagement.saveFailed', 'Could not save the connection.'));
      return body as TestManagementSummary;
    },
    onSuccess: () => {
      setName('');
      setBaseUrl('');
      setUsername('');
      setProjectKey('');
      setSuiteId('');
      setTestPlanKey('');
      setToken('');
      setFormError('');
      queryClient.invalidateQueries({ queryKey: ['testManagement'] });
    },
    onError: (mutationError: Error) => setFormError(mutationError.message),
  });

  const check = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/test-management/${id}/test`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('testManagement.checkFailed', 'Could not check the connection.'));
      return body as { ok: boolean; detail: string };
    },
    onMutate: () => setChecked(null),
    onSuccess: (result) => setChecked(result),
    onError: (checkError: Error) => setChecked({ ok: false, detail: checkError.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/test-management/${id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('testManagement.deleteFailed', 'Could not delete the connection.'));
      return body as { plansStoppedPublishing: number };
    },
    onSuccess: (result) => {
      setNotice(
        result.plansStoppedPublishing > 0
          ? t('testManagement.deleted', '{{count}} plan(s) that published to it no longer publish anywhere.', { count: result.plansStoppedPublishing })
          : '',
      );
      queryClient.invalidateQueries({ queryKey: ['testManagement'] });
    },
    onError: (removeError: Error) => setNotice(removeError.message),
  });

  const submit = () => {
    if (!name.trim()) return setFormError(t('testManagement.nameRequired', 'A name is required.'));
    if (!fields.defaultBaseUrl && !baseUrl.trim()) return setFormError(t('testManagement.addressRequired', 'The address of the tool is required.'));
    if (fields.username === 'required' && !username.trim()) return setFormError(t('testManagement.usernameRequired', '{{field}} is required.', { field: labels.username }));
    if (!projectKey.trim()) return setFormError(t('testManagement.projectRequired', 'The project is required.'));
    if (!token.trim()) return setFormError(t('testManagement.usernameRequired', '{{field}} is required.', { field: labels.token }));
    setFormError('');
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <span>{t('testManagement.title', 'Test management')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'testManagement.description',
            'TestRail, Xray or Zephyr Scale. A plan that names one publishes every finished run there — a TestRail run, an Xray Test Execution, a Zephyr test cycle — with each test’s result under its case.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="tmProvider">{t('testManagement.provider', 'Tool')}</Label>
            <Select value={provider} onValueChange={(value) => setProvider(value as TestManagementProvider)}>
              <SelectTrigger id="tmProvider" className="mt-1" aria-label={t('testManagement.provider', 'Tool')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_MANAGEMENT_PROVIDERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PROVIDER_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tmName">{t('testManagement.name', 'Name')}</Label>
            <Input id="tmName" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={PROVIDER_LABELS[provider]} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="tmBaseUrl">{t('testManagement.address', 'Address')}</Label>
            <Input
              id="tmBaseUrl"
              className="mt-1 font-mono text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={fields.defaultBaseUrl ?? (provider === 'testrail' ? 'https://acme.testrail.io' : 'https://jira.acme.com')}
            />
            {fields.defaultBaseUrl && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('testManagement.addressDefault', 'Empty for {{url}}; the EU or US address for data kept there.', { url: fields.defaultBaseUrl })}
              </p>
            )}
          </div>
          {fields.username !== 'none' && (
            <div>
              <Label htmlFor="tmUsername">{labels.username}</Label>
              <Input id="tmUsername" className="mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div>
            <Label htmlFor="tmToken">{labels.token}</Label>
            <Input id="tmToken" className="mt-1" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground mt-1">{t('testManagement.tokenHint', 'Stored encrypted and never shown again.')}</p>
          </div>
          <div>
            <Label htmlFor="tmProject">{labels.project}</Label>
            <Input id="tmProject" className="mt-1" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder={fields.projectIsNumber ? '3' : 'SHOP'} />
          </div>
          {fields.suite && (
            <div>
              <Label htmlFor="tmSuite">{t('testManagement.suite', 'Suite id (for a project with several suites)')}</Label>
              <Input id="tmSuite" className="mt-1" value={suiteId} onChange={(e) => setSuiteId(e.target.value)} />
            </div>
          )}
          {fields.testPlan && (
            <div>
              <Label htmlFor="tmTestPlan">{t('testManagement.testPlan', 'Xray Test Plan (optional)')}</Label>
              <Input id="tmTestPlan" className="mt-1" value={testPlanKey} onChange={(e) => setTestPlanKey(e.target.value)} placeholder="SHOP-100" />
            </div>
          )}
        </div>

        {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
        <Button onClick={submit} disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('testManagement.add', 'Add connection')}
        </Button>

        {check.isPending && (
          <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('testManagement.checking', 'Reading the project…')}
          </p>
        )}
        {checked && <p className={`text-sm ${checked.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'}`} role="status">{checked.detail}</p>}
        {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('testManagement.loading', 'Loading…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('testManagement.empty', 'No connection yet: runs are published nowhere.')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('testManagement.columns.name', 'Name')}</TableHead>
                <TableHead>{t('testManagement.columns.project', 'Project')}</TableHead>
                <TableHead className="text-right">{t('testManagement.columns.actions', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <TableRow key={connection.id} data-testid={`tm-${connection.name}`}>
                  <TableCell className="font-medium">
                    {connection.name}
                    <Badge variant="secondary" className="ml-2 font-normal">{PROVIDER_LABELS[connection.provider] ?? connection.provider}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground break-all">
                    {connection.projectKey}
                    {connection.suiteId ? ` · suite ${connection.suiteId}` : ''}
                    {connection.testPlanKey ? ` · ${connection.testPlanKey}` : ''}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => setMapping(connection)} title={t('testManagement.mapCases', 'Test cases')} aria-label={t('testManagement.mapCases', 'Test cases')}>
                      <ListChecks className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => check.mutate(connection.id)} disabled={check.isPending} title={t('testManagement.check', 'Test connection')} aria-label={t('testManagement.check', 'Test connection')}>
                      <PlugZap className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(connection.id)} disabled={remove.isPending} title={t('testManagement.delete', 'Delete')} aria-label={t('testManagement.delete', 'Delete')}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <TestCasesDialog connection={mapping} onClose={() => setMapping(null)} />
    </Card>
  );
};

export default TestManagementCard;
