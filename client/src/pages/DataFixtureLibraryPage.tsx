import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DATA_FIXTURE_PARAM_TYPES,
  LibraryFixtureDefinitionSchema,
  type DataFixtureDependency,
  type DataFixtureParam,
  type LibraryFixtureDefinition,
} from '@shared/schema';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pencil, Play, PlusCircle, Trash2, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useConfirm } from '@/hooks/use-confirm';
import { useToast } from '@/hooks/use-toast';
import { useProjects } from '@/hooks/use-projects';
import { useEnvironments } from '@/hooks/use-environments';
import {
  dependencyChain,
  libraryCall,
  libraryKey,
  ledgerKey,
  useFixtureLedger,
  useFixtureDetail,
  useFixtureLibrary,
  useFixtureReferences,
  type FixtureTryResult,
  type LedgerRow,
  type LibraryFixtureReferences,
  type LibraryFixtureSummary,
} from '@/hooks/use-data-fixture-library';

/**
 * The project's data fixture library: data a test needs in the application's database, written
 * once with its parameters and the fixtures it needs first, kept in versions, and named by tests
 * instead of copied. Viewers read; editors keep them and try them against an environment.
 */

interface Draft {
  key: string;
  name: string;
  description: string;
  tags: string;
  note: string;
  definition: LibraryFixtureDefinition;
}

const emptyDefinition = (): LibraryFixtureDefinition => ({
  connection: null,
  params: [],
  check: '',
  apply: '',
  outputs: [],
  timeoutMs: null,
  dependsOn: [],
});

const draftOf = (fixture: LibraryFixtureSummary | null): Draft => ({
  key: fixture?.key ?? '',
  name: fixture?.name ?? '',
  description: fixture?.description ?? '',
  tags: (fixture?.tags ?? []).join(', '),
  note: '',
  definition: fixture ? structuredClone(fixture.definition) : emptyDefinition(),
});

/** What the server would refuse in the definition, in a reader's words. */
export function definitionProblems(definition: LibraryFixtureDefinition): string[] {
  const parsed = LibraryFixtureDefinitionSchema.safeParse(definition);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const field = issue.path.join('.');
    return field ? `${field}: ${issue.message}` : issue.message;
  });
}

function FixtureEditor({
  projectId,
  fixture,
  library,
  canEdit,
  onClose,
}: {
  projectId: number;
  fixture: LibraryFixtureSummary | null;
  library: LibraryFixtureSummary[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(fixture));
  const [serverError, setServerError] = useState<string | null>(null);
  const problems = useMemo(() => definitionProblems(draft.definition), [draft.definition]);
  const detail = useFixtureDetail(fixture?.id ?? null);
  const references = useFixtureReferences(fixture?.id ?? null);
  const def = draft.definition;
  const setDef = (patch: Partial<LibraryFixtureDefinition>) =>
    setDraft((d) => ({ ...d, definition: { ...d.definition, ...patch } }));
  const setParam = (i: number, patch: Partial<DataFixtureParam>) =>
    setDef({ params: def.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setDep = (i: number, patch: Partial<DataFixtureDependency>) =>
    setDef({ dependsOn: def.dependsOn.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const others = library.filter((f) => f.id !== fixture?.id);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name,
        description: draft.description.trim() || null,
        tags: draft.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        definition: draft.definition,
        note: draft.note.trim() || null,
      };
      return fixture
        ? libraryCall('PUT', `/api/data-fixtures/${fixture.id}`, body)
        : libraryCall('POST', `/api/projects/${projectId}/data-fixtures`, {
            ...body,
            key: draft.key,
          });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataFixtureLibrary'] });
      onClose();
    },
    onError: (e: Error) => setServerError(e.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {fixture
              ? t('fixtureLibrary.editTitle', '{{name}} (v{{version}})', {
                  name: fixture.name,
                  version: fixture.currentVersion,
                })
              : t('fixtureLibrary.newTitle', 'New library fixture')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'fixtureLibrary.editorHint',
              'Saving a changed definition keeps it as a new version; tests on "latest" follow it, pinned tests do not.',
            )}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fixture-key">{t('fixtureLibrary.key', 'Key')}</Label>
              <Input
                id="fixture-key"
                className="font-mono"
                value={draft.key}
                disabled={!!fixture}
                placeholder="customer-with-contract"
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fixture-name">{t('dataFixtures.name')}</Label>
              <Input
                id="fixture-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fixture-connection">{t('dataFixtures.connection')}</Label>
              <Input
                id="fixture-connection"
                className="font-mono"
                placeholder="db.url"
                value={def.connection ?? ''}
                onChange={(e) => setDef({ connection: e.target.value.trim() || null })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fixture-description">
                {t('fixtureLibrary.description', 'Description')}
              </Label>
              <Input
                id="fixture-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fixture-tags">{t('fixtureLibrary.tags', 'Tags')}</Label>
              <Input
                id="fixture-tags"
                value={draft.tags}
                placeholder="billing, smoke"
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('dataFixtures.params')}</Label>
            {def.params.map((param, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={t('dataFixtures.paramName')}
                  className="w-40 font-mono"
                  value={param.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                />
                <Select
                  value={param.type}
                  onValueChange={(type) => setParam(i, { type: type as DataFixtureParam['type'] })}
                >
                  <SelectTrigger className="w-32" aria-label={t('dataFixtures.paramType')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_FIXTURE_PARAM_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={t('dataFixtures.paramValue')}
                  className="flex-1 font-mono"
                  value={param.value}
                  onChange={(e) => setParam(i, { value: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('dataFixtures.removeParam')}
                  onClick={() => setDef({ params: def.params.filter((_, j) => j !== i) })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDef({ params: [...def.params, { name: '', type: 'string', value: '' }] })
              }
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {t('dataFixtures.addParam')}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>{t('fixtureLibrary.dependsOn', 'Needs first')}</Label>
            {def.dependsOn.map((dep, i) => {
              const needed = others.find((f) => f.key === dep.fixture);
              return (
                <div key={i} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={dep.fixture}
                      onValueChange={(key) => setDep(i, { fixture: key, params: {} })}
                    >
                      <SelectTrigger
                        className="w-64"
                        aria-label={t('fixtureLibrary.dependency', 'Fixture needed')}
                      >
                        <SelectValue
                          placeholder={t('fixtureLibrary.dependency', 'Fixture needed')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {others.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.name} ({f.key})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={t('fixtureLibrary.dependencyAlias', 'Read as')}
                      className="w-48 font-mono"
                      value={dep.as}
                      onChange={(e) => setDep(i, { as: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {`{{fx.${dep.as || 'alias'}.${needed?.definition.outputs[0] ?? 'id'}}}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('fixtureLibrary.removeDependency', 'Remove dependency')}
                      onClick={() => setDef({ dependsOn: def.dependsOn.filter((_, j) => j !== i) })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {needed?.definition.params.map((param) => (
                    <div key={param.name} className="flex items-center gap-2 pl-4">
                      <span className="w-40 font-mono text-xs">{param.name}</span>
                      <Input
                        aria-label={t('dataFixtures.library.valueFor', { name: param.name })}
                        className="flex-1 font-mono"
                        placeholder={param.value}
                        value={dep.params[param.name] ?? ''}
                        onChange={(e) => {
                          const params = { ...dep.params };
                          if (e.target.value === '') delete params[param.name];
                          else params[param.name] = e.target.value;
                          setDep(i, { params });
                        }}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              disabled={others.length === 0}
              onClick={() =>
                setDef({
                  dependsOn: [
                    ...def.dependsOn,
                    { fixture: '', as: `dep${def.dependsOn.length + 1}`, params: {} },
                  ],
                })
              }
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {t('fixtureLibrary.addDependency', 'Add a fixture it needs')}
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fixture-check">{t('dataFixtures.check')}</Label>
            <Textarea
              id="fixture-check"
              rows={3}
              className="font-mono text-xs"
              value={def.check}
              onChange={(e) => setDef({ check: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fixture-apply">{t('dataFixtures.apply')}</Label>
            <Textarea
              id="fixture-apply"
              rows={6}
              className="font-mono text-xs"
              value={def.apply}
              onChange={(e) => setDef({ apply: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t('dataFixtures.applyHint', { param: '{{params.name}}', variable: '{{variable}}' })}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fixture-teardown">{t('dataFixtures.teardown')}</Label>
            <Textarea
              id="fixture-teardown"
              rows={4}
              className="font-mono text-xs"
              value={def.teardown ?? ''}
              onChange={(e) => setDef({ teardown: e.target.value || null })}
            />
            <p className="text-xs text-muted-foreground">
              {t('dataFixtures.teardownHint', { example: `{{fx.self.${def.outputs[0] || 'id'}}}` })}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fixture-outputs">{t('dataFixtures.outputs')}</Label>
              <Input
                id="fixture-outputs"
                className="font-mono"
                value={def.outputs.join(', ')}
                onChange={(e) =>
                  setDef({
                    outputs: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fixture-timeout">{t('dataFixtures.timeout')}</Label>
              <Input
                id="fixture-timeout"
                type="number"
                min={1}
                max={300}
                placeholder="30"
                value={def.timeoutMs ? def.timeoutMs / 1000 : ''}
                onChange={(e) => {
                  const seconds = Number(e.target.value);
                  setDef({
                    timeoutMs: e.target.value && seconds > 0 ? Math.round(seconds * 1000) : null,
                  });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fixture-note">
                {t('fixtureLibrary.note', 'What this version changes')}
              </Label>
              <Input
                id="fixture-note"
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </div>
          </div>
        </fieldset>

        {problems.map((p) => (
          <p key={p} className="text-xs text-destructive">
            {p}
          </p>
        ))}
        {serverError && (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        )}

        {fixture && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t('fixtureLibrary.versions', 'Versions')}</h3>
              <ul className="space-y-1 text-xs">
                {detail.data?.versions.map((v) => (
                  <li key={v.version}>
                    <span className="font-mono">v{v.version}</span> ·{' '}
                    {new Date(v.createdAt).toLocaleString()}
                    {v.note ? ` · ${v.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <ReferenceList references={references.data} />
          </div>
        )}
        {fixture && canEdit && <TryIt fixture={fixture} />}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          {canEdit && (
            <Button
              disabled={save.isPending || problems.length > 0 || !draft.name.trim() || !draft.key}
              onClick={() => {
                setServerError(null);
                save.mutate();
              }}
            >
              {t('common.save', 'Save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceList({ references }: { references?: LibraryFixtureReferences }) {
  const { t } = useTranslation();
  if (!references) return null;
  const none = references.tests.length === 0 && references.fixtures.length === 0;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">{t('fixtureLibrary.usedBy', 'Used by')}</h3>
      {none && (
        <p className="text-xs text-muted-foreground">
          {t('fixtureLibrary.unused', 'No test or fixture names it.')}
        </p>
      )}
      <ul className="space-y-1 text-xs">
        {references.tests.map((test) => (
          <li key={`t${test.id}`}>
            {t('fixtureLibrary.usedByTest', 'Test')}: {test.name}
          </li>
        ))}
        {references.fixtures.map((f) => (
          <li key={`f${f.id}`}>
            {t('fixtureLibrary.usedByFixture', 'Fixture')}: {f.name} ({f.key})
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Runs the fixture, with what it needs first, against an environment: a check or a dry run. */
function TryIt({ fixture }: { fixture: LibraryFixtureSummary }) {
  const { t } = useTranslation();
  const { data: environments = [] } = useEnvironments();
  const [environmentId, setEnvironmentId] = useState<string>('');
  const [mode, setMode] = useState<'check' | 'dry'>('check');
  const run = useMutation({
    mutationFn: () =>
      libraryCall<FixtureTryResult>('POST', `/api/data-fixtures/${fixture.id}/try`, {
        environmentId: Number(environmentId),
        mode,
      }),
  });
  const chosen = environments.find((e) => String(e.id) === environmentId);

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <h3 className="text-sm font-semibold">{t('fixtureLibrary.tryIt', 'Try it')}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={environmentId} onValueChange={setEnvironmentId}>
          <SelectTrigger
            className="w-56"
            aria-label={t('fixtureLibrary.environment', 'Environment')}
          >
            <SelectValue placeholder={t('fixtureLibrary.environment', 'Environment')} />
          </SelectTrigger>
          <SelectContent>
            {environments.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mode} onValueChange={(m) => setMode(m as 'check' | 'dry')}>
          <SelectTrigger className="w-72" aria-label={t('fixtureLibrary.mode', 'Mode')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="check">
              {t('fixtureLibrary.modeCheck', 'Check only (reads, writes nothing)')}
            </SelectItem>
            <SelectItem value="dry">
              {t('fixtureLibrary.modeDry', 'Dry run (writes, then rolls back)')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!environmentId || run.isPending} onClick={() => run.mutate()}>
          <Play className="mr-2 h-4 w-4" />
          {t('fixtureLibrary.run', 'Run')}
        </Button>
      </div>
      {mode === 'dry' && chosen && !chosen.dataSetup && (
        <p className="text-xs text-muted-foreground">
          {t(
            'fixtureLibrary.dryNeedsSetup',
            'A dry run needs an environment that allows data setup.',
          )}
        </p>
      )}
      {run.error && (
        <p role="alert" className="text-xs text-destructive">
          {(run.error as Error).message}
        </p>
      )}
      {run.data && (
        <div className="space-y-1 text-xs">
          <p className={run.data.ok ? 'text-green-700' : 'text-destructive'}>
            {run.data.ok
              ? t('fixtureLibrary.tryOk', 'Everything the fixture needs is in place.')
              : `${run.data.failedAt ?? ''}: ${run.data.reason ?? ''}`}
          </p>
          <ul className="space-y-1">
            {run.data.steps.map((step) => (
              <li key={step.id}>
                <Badge variant="outline" className="mr-2">
                  {t(`fixtureLibrary.status.${step.status}`, step.status)}
                </Badge>
                {step.name}
                {step.source ? ` (${step.source})` : ''} · {step.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The data runs applied and have not taken back: a killed run, a teardown that failed or that the
 * policy kept. An editor runs the teardown from here, on the environment the data was applied to.
 */
export function FixtureLedger() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rows = [] } = useFixtureLedger();
  const run = useMutation({
    mutationFn: (row: LedgerRow) =>
      libraryCall('POST', `/api/data-fixture-ledger/${row.id}/teardown`),
    onSuccess: () => toast({ title: t('dataFixtures.ledger.done') }),
    onError: (e: Error) =>
      toast({
        variant: 'destructive',
        title: t('dataFixtures.ledger.failed'),
        description: e.message,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ledgerKey }),
  });
  const runnable = (row: LedgerRow) => ['pending', 'failed', 'applying'].includes(row.status);

  return (
    <section className="mt-8 space-y-2" aria-labelledby="fixture-ledger-title">
      <h2 id="fixture-ledger-title" className="text-lg font-semibold">
        {t('dataFixtures.ledger.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('dataFixtures.ledger.description')}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dataFixtures.ledger.empty')}</p>
      ) : (
        <div className="grid gap-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-start justify-between gap-4 p-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{row.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{row.alias}</span>
                    <Badge variant={row.status === 'failed' ? 'destructive' : 'secondary'}>
                      {t(`dataFixtures.ledger.statuses.${row.status}`)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('dataFixtures.ledger.run')}: {row.runId} · {t('dataFixtures.ledger.applied')}
                    : {new Date(row.appliedAt).toLocaleString()}
                  </p>
                  {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
                </div>
                {runnable(row) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={run.isPending}
                    aria-label={t('dataFixtures.ledger.runTeardownFor', { name: row.name })}
                    onClick={() => run.mutate(row)}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {t('dataFixtures.ledger.runTeardown')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DataFixtureLibraryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [open, setOpen] = useState<LibraryFixtureSummary | 'new' | null>(null);
  const { data: library = [], isLoading, error } = useFixtureLibrary(projectId);
  const project = projects.find((p) => p.id === projectId);
  const canEdit = user?.role !== 'viewer' && project?.access !== 'viewer';

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const remove = useMutation({
    mutationFn: (fixture: LibraryFixtureSummary) =>
      libraryCall('DELETE', `/api/data-fixtures/${fixture.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(projectId) }),
    onError: (e: Error & { body?: unknown }) => {
      const refs = e.body as Partial<LibraryFixtureReferences> | undefined;
      const names = [
        ...(refs?.tests ?? []).map((x) => x.name),
        ...(refs?.fixtures ?? []).map((x) => x.key),
      ];
      toast({
        variant: 'destructive',
        title: t('fixtureLibrary.deleteFailed', 'Not deleted'),
        description: names.length
          ? t('fixtureLibrary.stillUsed', 'Still named by: {{names}}', { names: names.join(', ') })
          : e.message,
      });
    },
  });

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      {confirmDialog}
      <PageHeader
        className="mb-6"
        title={t('fixtureLibrary.title', 'Data fixture library')}
        description={t(
          'fixtureLibrary.pageDescription',
          'The data tests need in the application database, written once per project, in versions, and named by tests instead of copied.',
        )}
        actions={
          canEdit &&
          projectId && (
            <Button onClick={() => setOpen('new')}>
              <PlusCircle className="mr-2 h-4 w-4" /> {t('fixtureLibrary.new', 'New fixture')}
            </Button>
          )
        }
      />
      <div className="mb-4 max-w-sm">
        <Select
          value={projectId ? String(projectId) : ''}
          onValueChange={(value) => setProjectId(Number(value))}
        >
          <SelectTrigger aria-label={t('dataFixtures.library.project')}>
            <SelectValue placeholder={t('dataFixtures.library.project')} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {(error as Error).message}
        </p>
      )}
      {projectId && !isLoading && library.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('dataFixtures.library.emptyProject')}</p>
      )}
      <div className="grid gap-3">
        {library.map((fixture) => {
          const chain = dependencyChain(fixture.key, library);
          return (
            <Card key={fixture.id}>
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{fixture.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{fixture.key}</span>
                    <Badge variant="secondary">v{fixture.currentVersion}</Badge>
                    {fixture.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {fixture.description && (
                    <p className="text-sm text-muted-foreground">{fixture.description}</p>
                  )}
                  {chain.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      {t('dataFixtures.library.runsInOrder', { chain: chain.join(' → ') })}
                    </p>
                  )}
                </div>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('fixtureLibrary.open', 'Open {{name}}', { name: fixture.name })}
                    onClick={() => setOpen(fixture)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      aria-label={t('fixtureLibrary.delete', 'Delete {{name}}', {
                        name: fixture.name,
                      })}
                      onClick={async () => {
                        const ok = await confirm({
                          destructive: true,
                          title: t(
                            'fixtureLibrary.confirmDelete',
                            'Delete {{name}} and its versions?',
                            {
                              name: fixture.name,
                            },
                          ),
                        });
                        if (ok) remove.mutate(fixture);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {canEdit && <FixtureLedger />}
      {open && projectId && (
        <FixtureEditor
          projectId={projectId}
          fixture={open === 'new' ? null : open}
          library={library}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
