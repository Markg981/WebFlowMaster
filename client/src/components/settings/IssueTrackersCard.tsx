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
import { Bug, Loader2, PlugZap, Trash2 } from 'lucide-react';

/**
 * Where this organization files its bugs.
 *
 * A failed run ended in the report, and getting it onto a board meant opening Jira in another
 * tab and retyping the test name, the browser, the error and a link — every morning, for the
 * same failure, because neither side knew the two were the same thing.
 *
 * The token is written once and never read back. There is no field here that shows it, not even
 * masked: a form that can display a secret is a form that puts it in a screenshot.
 */

interface IssueTrackerSummary {
  id: string;
  name: string;
  provider: 'jira' | 'azure_devops';
  baseUrl: string;
  projectKey: string;
  issueType: string;
  authenticatesAs: string | null;
  createdAt: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  jira: 'Jira',
  azure_devops: 'Azure DevOps',
};

const IssueTrackersCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<'jira' | 'azure_devops'>('jira');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [issueType, setIssueType] = useState('Bug');
  const [userEmail, setUserEmail] = useState('');
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState('');
  const [checked, setChecked] = useState<{ id: string; ok: boolean; detail: string } | null>(null);

  const { data: trackers = [], isLoading, error } = useQuery<IssueTrackerSummary[]>({
    queryKey: ['issueTrackers'],
    queryFn: async () => {
      const response = await fetch('/api/issue-trackers');
      if (!response.ok) throw new Error('Could not load the issue trackers');
      return response.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/issue-trackers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          baseUrl: baseUrl.trim(),
          projectKey: projectKey.trim(),
          issueType: issueType.trim() || 'Bug',
          userEmail: provider === 'jira' ? userEmail.trim() : null,
          token: token.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save the tracker');
      return body as IssueTrackerSummary;
    },
    onSuccess: () => {
      setName('');
      setBaseUrl('');
      setProjectKey('');
      setUserEmail('');
      setToken('');
      setFormError('');
      queryClient.invalidateQueries({ queryKey: ['issueTrackers'] });
    },
    onError: (mutationError: Error) => setFormError(mutationError.message),
  });

  const check = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/issue-trackers/${id}/test`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not check the tracker');
      return { id, ...(body as { ok: boolean; detail: string }) };
    },
    onSuccess: (result) => setChecked(result),
    onError: (checkError: Error) => setChecked({ id: '', ok: false, detail: checkError.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/issue-trackers/${id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not delete the tracker');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issueTrackers'] }),
  });

  const submit = () => {
    if (name.trim() === '' || baseUrl.trim() === '' || projectKey.trim() === '' || token.trim() === '') {
      setFormError(t('issueTrackers.allFieldsRequired', 'Name, URL, project and token are all needed.'));
      return;
    }
    if (provider === 'jira' && userEmail.trim() === '') {
      setFormError(t('issueTrackers.emailRequired', 'Jira needs the email address the API token belongs to.'));
      return;
    }
    setFormError('');
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span>{t('issueTrackers.title', 'Issue trackers')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'issueTrackers.description',
            'Where a failing test becomes somebody’s ticket. A plan can then file its failures automatically, and the same failure the next night becomes a comment rather than a second issue.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="trackerProvider">{t('issueTrackers.provider', 'Provider')}</Label>
            <Select value={provider} onValueChange={(value) => setProvider(value as 'jira' | 'azure_devops')}>
              <SelectTrigger id="trackerProvider" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jira">Jira</SelectItem>
                <SelectItem value="azure_devops">Azure DevOps</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="trackerName">{t('issueTrackers.name', 'Name')}</Label>
            <Input
              id="trackerName"
              className="mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('issueTrackers.namePlaceholder', 'Jira — Shop')}
            />
          </div>
          <div>
            <Label htmlFor="trackerBaseUrl">{t('issueTrackers.baseUrl', 'Base URL')}</Label>
            <Input
              id="trackerBaseUrl"
              className="mt-1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={provider === 'jira' ? 'https://acme.atlassian.net' : 'https://dev.azure.com/acme'}
            />
          </div>
          <div>
            <Label htmlFor="trackerProject">
              {provider === 'jira'
                ? t('issueTrackers.projectKey', 'Project key')
                : t('issueTrackers.projectName', 'Project name')}
            </Label>
            <Input
              id="trackerProject"
              className="mt-1"
              value={projectKey}
              onChange={(event) => setProjectKey(event.target.value)}
              placeholder={provider === 'jira' ? 'SHOP' : 'Platform'}
            />
          </div>
          <div>
            <Label htmlFor="trackerIssueType">{t('issueTrackers.issueType', 'Issue type')}</Label>
            <Input
              id="trackerIssueType"
              className="mt-1"
              value={issueType}
              onChange={(event) => setIssueType(event.target.value)}
            />
          </div>
          {provider === 'jira' && (
            <div>
              <Label htmlFor="trackerEmail">{t('issueTrackers.userEmail', 'Account email')}</Label>
              <Input
                id="trackerEmail"
                className="mt-1"
                value={userEmail}
                onChange={(event) => setUserEmail(event.target.value)}
                placeholder="qa@acme.test"
              />
            </div>
          )}
          <div className="md:col-span-2">
            <Label htmlFor="trackerToken">
              {provider === 'jira'
                ? t('issueTrackers.apiToken', 'API token')
                : t('issueTrackers.pat', 'Personal access token')}
            </Label>
            <Input
              id="trackerToken"
              className="mt-1"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                'issueTrackers.tokenHint',
                'Stored encrypted and never shown again. To change it, type a new one.',
              )}
            </p>
          </div>
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <Button onClick={submit} disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('issueTrackers.add', 'Add tracker')}
        </Button>

        {checked && (
          <p className={`text-sm ${checked.ok ? 'text-green-600' : 'text-destructive'}`}>{checked.detail}</p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('issueTrackers.loading', 'Loading…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : trackers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('issueTrackers.empty', 'No tracker yet. Until there is one, failures stay in the report.')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('issueTrackers.columns.name', 'Name')}</TableHead>
                <TableHead>{t('issueTrackers.columns.project', 'Project')}</TableHead>
                <TableHead>{t('issueTrackers.columns.account', 'Authenticates as')}</TableHead>
                <TableHead className="text-right">{t('issueTrackers.columns.actions', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trackers.map((tracker) => (
                <TableRow key={tracker.id}>
                  <TableCell className="font-medium">
                    {tracker.name}
                    <Badge variant="secondary" className="ml-2 font-normal">
                      {PROVIDER_LABEL[tracker.provider] ?? tracker.provider}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {tracker.projectKey} · {tracker.issueType}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{tracker.authenticatesAs ?? '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => check.mutate(tracker.id)}
                      disabled={check.isPending}
                      title={t('issueTrackers.check', 'Test connection')}
                    >
                      <PlugZap className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(tracker.id)}
                      disabled={remove.isPending}
                      title={t('issueTrackers.delete', 'Delete')}
                    >
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

export default IssueTrackersCard;
