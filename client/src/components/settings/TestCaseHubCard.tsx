import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FolderGit2, Loader2, PlugZap, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime } from '@/lib/dates';
import {
  hubErrorMessage,
  useCheckHubSource,
  useHubSource,
  useRefreshHub,
  useRemoveHubSource,
  useSaveHubSource,
  type HubSourceInput,
  type HubSourceKind,
  type HubSourceSummary,
} from '@/hooks/useTestCaseHub';

/**
 * Where this organization's QA test case hub lives.
 *
 * The hub is a git repository of test case definitions, one JSON file per case, kept by the QA
 * team. This card points WebFlowMaster at it — a folder the server can see, or an Azure DevOps
 * repository read through its API — and refreshes the catalog from it. Choosing which cases
 * become tests happens in Test Manager, not here.
 *
 * The token is written once and never read back, as an issue tracker's: the form shows that one
 * is stored, never what it is.
 */

type Draft = {
  kind: HubSourceKind;
  name: string;
  path: string;
  baseUrl: string;
  project: string;
  repository: string;
  branch: string;
  token: string;
};

const EMPTY_DRAFT: Draft = {
  kind: 'folder',
  name: '',
  path: '',
  baseUrl: '',
  project: '',
  repository: '',
  branch: 'main',
  token: '',
};

function draftOf(source: HubSourceSummary | null | undefined): Draft {
  if (!source) return EMPTY_DRAFT;
  return {
    kind: source.kind,
    name: source.name,
    path: source.path ?? '',
    baseUrl: source.baseUrl ?? '',
    project: source.project ?? '',
    repository: source.repository ?? '',
    branch: source.branch ?? 'main',
    token: '',
  };
}

const TestCaseHubCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';

  const { data: source, isLoading, error } = useHubSource();
  const save = useSaveHubSource();
  const remove = useRemoveHubSource();
  const check = useCheckHubSource();
  const refresh = useRefreshHub();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState('');
  const [checked, setChecked] = useState<{ ok: boolean; detail: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // The form follows the saved source, and a token typed but not saved is dropped with it.
  useEffect(() => {
    setDraft(draftOf(source));
    setChecked(null);
  }, [source]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const keepsToken = source?.kind === 'azure-devops' && source.hasToken;

  const submit = () => {
    const name = draft.name.trim();
    if (name === '') {
      setFormError(t('testCaseHub.form.nameRequired', 'Give the hub a name.'));
      return;
    }
    let input: HubSourceInput;
    if (draft.kind === 'folder') {
      if (draft.path.trim() === '') {
        setFormError(t('testCaseHub.form.pathRequired', 'The folder path is needed.'));
        return;
      }
      input = { kind: 'folder', name, path: draft.path.trim() };
    } else {
      if (
        draft.baseUrl.trim() === '' ||
        draft.project.trim() === '' ||
        draft.repository.trim() === ''
      ) {
        setFormError(
          t(
            'testCaseHub.form.devopsFieldsRequired',
            'Organization URL, project and repository are all needed.',
          ),
        );
        return;
      }
      if (draft.token.trim() === '' && !keepsToken) {
        setFormError(t('testCaseHub.form.tokenRequired', 'A personal access token is needed.'));
        return;
      }
      input = {
        kind: 'azure-devops',
        name,
        baseUrl: draft.baseUrl.trim(),
        project: draft.project.trim(),
        repository: draft.repository.trim(),
        branch: draft.branch.trim() || 'main',
        ...(draft.token.trim() !== '' ? { token: draft.token.trim() } : {}),
      };
    }
    setFormError('');
    save.mutate(input, {
      onSuccess: () => toast({ title: t('testCaseHub.toast.saved', 'Test case hub saved.') }),
      onError: (saveError) => setFormError(hubErrorMessage(saveError, t)),
    });
  };

  const runCheck = () =>
    check.mutate(undefined, {
      onSuccess: (result) => setChecked(result),
      onError: (checkError) => setChecked({ ok: false, detail: hubErrorMessage(checkError, t) }),
    });

  const runRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) =>
        toast({
          title: t('testCaseHub.toast.refreshed', 'Catalog refreshed'),
          description: t('testCaseHub.toast.refreshSummary', {
            defaultValue:
              '{{cases}} cases: {{added}} new, {{updated}} changed, {{missing}} no longer in the hub.',
            cases: result.cases,
            added: result.added,
            updated: result.updated,
            missing: result.missing,
          }),
        }),
      onError: (refreshError) =>
        toast({
          title: t('testCaseHub.toast.refreshFailed', 'The catalog could not be refreshed'),
          description: hubErrorMessage(refreshError, t),
          variant: 'destructive',
        }),
    });

  const runRemove = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        setConfirmRemove(false);
        toast({ title: t('testCaseHub.toast.removed', 'Test case hub removed.') });
      },
      onError: (removeError) =>
        toast({
          title: t('common.error'),
          description: hubErrorMessage(removeError, t),
          variant: 'destructive',
        }),
    });

  const busy = save.isPending || remove.isPending || check.isPending || refresh.isPending;
  const disabled = !canEdit || busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FolderGit2 className="h-4 w-4 text-muted-foreground" />
          <span>{t('testCaseHub.title', 'QA test case hub')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'testCaseHub.description',
            'The repository where the QA team keeps its test case definitions, one JSON file per case. Point WebFlowMaster at it, refresh the catalog, then pick in Test Manager which cases become manual tests here.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('testCaseHub.loading', 'Loading…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{hubErrorMessage(error, t)}</p>
        ) : (
          <>
            {source && (
              <div
                className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
                data-testid="hub-status"
              >
                {source.lastRefreshStatus === 'ok' ? (
                  <Badge>{t('testCaseHub.status.ok', 'Catalog up to date')}</Badge>
                ) : source.lastRefreshStatus === 'failed' ? (
                  <Badge variant="destructive">
                    {t('testCaseHub.status.failed', 'Last refresh failed')}
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {t('testCaseHub.status.never', 'Never refreshed')}
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  {t('testCaseHub.status.cases', {
                    defaultValue: '{{count}} cases in the catalog',
                    count: source.caseCount,
                  })}
                </span>
                {source.lastRefreshAt && (
                  <span className="text-muted-foreground">
                    · {formatDateTime(source.lastRefreshAt, i18n.language)}
                    {source.lastRefreshHead && (
                      <code className="ml-1 text-xs">{source.lastRefreshHead.slice(0, 10)}</code>
                    )}
                  </span>
                )}
                {source.lastRefreshStatus === 'failed' && source.lastRefreshError && (
                  <p className="w-full text-destructive">{source.lastRefreshError}</p>
                )}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="hubKind">{t('testCaseHub.form.kind', 'Where it lives')}</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(value) => set('kind', value as HubSourceKind)}
                  disabled={disabled}
                >
                  <SelectTrigger id="hubKind" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="folder">
                      {t('testCaseHub.form.kindFolder', 'Folder on the server')}
                    </SelectItem>
                    <SelectItem value="azure-devops">
                      {t('testCaseHub.form.kindAzureDevOps', 'Azure DevOps repository')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="hubName">{t('testCaseHub.form.name', 'Name')}</Label>
                <Input
                  id="hubName"
                  className="mt-1"
                  value={draft.name}
                  onChange={(event) => set('name', event.target.value)}
                  placeholder={t('testCaseHub.form.namePlaceholder', 'CoE QA test cases')}
                  disabled={disabled}
                />
              </div>

              {draft.kind === 'folder' ? (
                <div className="md:col-span-2">
                  <Label htmlFor="hubPath">{t('testCaseHub.form.path', 'Folder')}</Label>
                  <Input
                    id="hubPath"
                    className="mt-1 font-mono text-sm"
                    value={draft.path}
                    onChange={(event) => set('path', event.target.value)}
                    placeholder="/srv/qa/CoE-QA-TestCasesHub"
                    disabled={disabled}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      'testCaseHub.form.pathHint',
                      'A clone of the hub on the server, under one of the folders the operator allowed (TESTCASE_HUB_ROOTS). It must contain TestCasesDefinitions.',
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="hubBaseUrl">
                      {t('testCaseHub.form.baseUrl', 'Organization URL')}
                    </Label>
                    <Input
                      id="hubBaseUrl"
                      className="mt-1"
                      value={draft.baseUrl}
                      onChange={(event) => set('baseUrl', event.target.value)}
                      placeholder="https://dev.azure.com/my-org"
                      disabled={disabled}
                    />
                  </div>
                  <div>
                    <Label htmlFor="hubProject">{t('testCaseHub.form.project', 'Project')}</Label>
                    <Input
                      id="hubProject"
                      className="mt-1"
                      value={draft.project}
                      onChange={(event) => set('project', event.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div>
                    <Label htmlFor="hubRepository">
                      {t('testCaseHub.form.repository', 'Repository')}
                    </Label>
                    <Input
                      id="hubRepository"
                      className="mt-1"
                      value={draft.repository}
                      onChange={(event) => set('repository', event.target.value)}
                      placeholder="CoE-QA-TestCasesHub"
                      disabled={disabled}
                    />
                  </div>
                  <div>
                    <Label htmlFor="hubBranch">{t('testCaseHub.form.branch', 'Branch')}</Label>
                    <Input
                      id="hubBranch"
                      className="mt-1"
                      value={draft.branch}
                      onChange={(event) => set('branch', event.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="hubToken">
                      {t('testCaseHub.form.token', 'Personal access token')}
                    </Label>
                    <Input
                      id="hubToken"
                      className="mt-1"
                      type="password"
                      autoComplete="off"
                      value={draft.token}
                      onChange={(event) => set('token', event.target.value)}
                      placeholder={
                        keepsToken
                          ? t('testCaseHub.form.tokenKept', 'Stored — leave empty to keep it')
                          : ''
                      }
                      disabled={disabled}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        'testCaseHub.form.tokenHint',
                        'Needs Code (read) on the repository. Stored encrypted and never shown again.',
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={submit} disabled={busy} data-testid="hub-save">
                  {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {source
                    ? t('testCaseHub.form.save', 'Save changes')
                    : t('testCaseHub.form.connect', 'Connect the hub')}
                </Button>
                {source && (
                  <>
                    <Button variant="outline" onClick={runCheck} disabled={busy}>
                      {check.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <PlugZap className="mr-2 h-4 w-4" />
                      )}
                      {t('testCaseHub.form.check', 'Test connection')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={runRefresh}
                      disabled={busy}
                      data-testid="hub-refresh"
                    >
                      {refresh.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {t('testCaseHub.form.refresh', 'Refresh catalog')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setConfirmRemove(true)}
                      disabled={busy}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('testCaseHub.form.remove', 'Remove')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {checked && (
              <p
                className={`text-sm ${checked.ok ? 'text-success' : 'text-destructive'}`}
                data-testid="hub-check-result"
              >
                {checked.ok
                  ? t('testCaseHub.form.checkOk', {
                      defaultValue: 'Reachable: {{detail}}',
                      detail: checked.detail,
                    })
                  : checked.detail}
              </p>
            )}

            {source && source.caseCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('testCaseHub.form.catalogHint', 'Choose which cases to import in')}{' '}
                <Link href="/test-manager?source=hub" className="underline">
                  {t('testCaseHub.form.catalogLink', 'Test Manager')}
                </Link>
                .
              </p>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('testCaseHub.remove.title', 'Remove the test case hub?')}
        description={t(
          'testCaseHub.remove.description',
          'The catalog is dropped. The tests already imported stay in the library as they are; they just stop being tied to the hub.',
        )}
        confirmLabel={t('testCaseHub.form.remove', 'Remove')}
        destructive
        pending={remove.isPending}
        onConfirm={runRemove}
      />
    </Card>
  );
};

export default TestCaseHubCard;
