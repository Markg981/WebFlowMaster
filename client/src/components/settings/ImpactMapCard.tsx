import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GitBranch, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * The impact map (server/test-impact.ts): which file patterns map to which tests' tags, so a run
 * asked for with a commit's changed files runs the tests that change affects. And a place to try
 * it on a list of files before a pipeline relies on it.
 */

interface Rule { id: string; pattern: string; tagId: string | null; tagName: string | null }
interface TagRow { id: string; name: string }
interface PlanRow { id: string; name: string }
interface Preview {
  selection: { mode: 'affected' | 'all'; reason: string; selected: number; total: number; unmappedFiles: string[] };
  tests: Array<{ type: string; name: string }>;
}

const NO_TEST = '__none__';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

const ImpactMapCard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [tagId, setTagId] = useState('');
  const [error, setError] = useState('');
  const [planId, setPlanId] = useState('');
  const [files, setFiles] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);

  const { data: rules = [], isLoading } = useQuery<Rule[]>({ queryKey: ['/api/impact-rules'], queryFn: () => getJson('/api/impact-rules') });
  const { data: tags = [] } = useQuery<TagRow[]>({ queryKey: ['/api/tags'], queryFn: () => getJson('/api/tags') });
  const { data: plans = [] } = useQuery<PlanRow[]>({ queryKey: ['/api/test-plans'], queryFn: () => getJson('/api/test-plans') });

  const add = useMutation({
    mutationFn: () => send('/api/impact-rules', 'POST', { pattern, tagId: tagId === NO_TEST ? null : tagId }),
    onSuccess: () => {
      setPattern('');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['/api/impact-rules'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => send(`/api/impact-rules/${id}`, 'DELETE'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/impact-rules'] }),
    onError: (e: Error) => setError(e.message),
  });
  const tryIt = useMutation({
    mutationFn: (): Promise<Preview> =>
      send('/api/impact-rules/preview', 'POST', { planId, changedFiles: files.split(/\r?\n/).map((f) => f.trim()).filter(Boolean) }),
    onSuccess: (result) => {
      setPreview(result);
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card data-testid="impact-map">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> {t('impactMap.title', 'Impact map')}</CardTitle>
        <CardDescription>
          {t(
            'impactMap.description',
            'Which files affect which tests. Map a file pattern to a tag: a run started with the files a commit changed (wfm run --changed-since) runs the tests carrying the tags those files map to, the tests the map does not cover, and those that failed last time. A changed file no rule matches runs every test.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('impactMap.empty', 'No rules: every run runs every test.')}</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm" data-testid="impact-rules">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <code className="break-all">{rule.pattern}</code>
                <span aria-hidden="true">→</span>
                {rule.tagName ? <Badge variant="secondary">{rule.tagName}</Badge> : <span className="text-muted-foreground">{t('impactMap.noTest', 'no test')}</span>}
                {canEdit && (
                  <Button variant="ghost" size="icon" className="ml-auto" aria-label={t('impactMap.remove', 'Remove rule')} onClick={() => remove.mutate(rule.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="impact-pattern">{t('impactMap.pattern', 'Files')}</Label>
              <Input id="impact-pattern" className="font-mono" placeholder="src/checkout/**" value={pattern} onChange={(e) => setPattern(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('impactMap.tag', 'Affect the tests tagged')}</Label>
              <Select value={tagId} onValueChange={setTagId}>
                <SelectTrigger className="w-48"><SelectValue placeholder={t('impactMap.chooseTag', 'Choose a tag')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEST}>{t('impactMap.noTestOption', 'No test (documentation…)')}</SelectItem>
                  {tags.map((tag) => <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => add.mutate()} disabled={!pattern.trim() || !tagId || add.isPending}>
              <Plus className="mr-1 h-4 w-4" /> {t('impactMap.add', 'Add rule')}
            </Button>
          </div>
        )}

        <section className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t('impactMap.tryTitle', 'Try it on a change')}</p>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger className="w-64 max-w-full"><SelectValue placeholder={t('impactMap.choosePlan', 'Choose a plan')} /></SelectTrigger>
            <SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea
            rows={4}
            className="font-mono text-xs"
            placeholder={t('impactMap.filesPlaceholder', 'One changed file per line, as git diff --name-only lists them')}
            value={files}
            onChange={(e) => setFiles(e.target.value)}
            data-testid="impact-files"
          />
          <Button variant="outline" onClick={() => tryIt.mutate()} disabled={!planId || !files.trim() || tryIt.isPending} data-testid="impact-preview">
            {t('impactMap.preview', 'Show which tests would run')}
          </Button>
          {preview && (
            <div className="space-y-2 text-sm" data-testid="impact-result">
              <p>
                <Badge variant={preview.selection.mode === 'affected' ? 'default' : 'outline'}>
                  {preview.selection.selected} / {preview.selection.total}
                </Badge>{' '}
                {preview.selection.reason}
              </p>
              <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
                {preview.tests.map((test, i) => (
                  <li key={`${test.type}-${test.name}-${i}`}>{test.name}{test.type !== 'ui' && <span className="text-xs text-muted-foreground"> · {test.type}</span>}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
};

export default ImpactMapCard;
