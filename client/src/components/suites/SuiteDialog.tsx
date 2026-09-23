import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

/**
 * Creating or changing a suite.
 *
 * A static suite is picked test by test; a dynamic one is a set of tags, and runs whatever carries
 * all of them when a run is created. For a suite that already exists the dialog also shows what it
 * runs right now, as the server works it out — the one answer that matters for a dynamic suite.
 */

export type SuiteKind = 'static' | 'dynamic';

export interface SuiteTestRef {
  type: 'ui' | 'api';
  id: number;
  /** Null when the test is in a project the requester cannot see: counted, not named. */
  name: string | null;
}

export interface SuiteDetail {
  id: number;
  name: string;
  description: string | null;
  kind: SuiteKind;
  projectId: number | null;
  tagIds: string[];
  tests: SuiteTestRef[];
  plans: Array<{ id: string; name: string }>;
}

export interface SuitePayload {
  name: string;
  description: string | null;
  kind: SuiteKind;
  projectId: number | null;
  tagIds: string[];
  items: Array<{ type: 'ui' | 'api'; id: number }>;
}

interface NamedRow {
  id: number;
  name: string;
}

interface TagRow {
  id: string;
  name: string;
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Could not load ${what}`);
  return response.json();
}

const key = (type: 'ui' | 'api', id: number) => `${type}:${id}`;

interface SuiteDialogProps {
  isOpen: boolean;
  /** The suite being changed; null to create one. */
  suite: SuiteDetail | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: SuitePayload) => void;
}

export default function SuiteDialog({ isOpen, suite, saving, onClose, onSave }: SuiteDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<SuiteKind>('static');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(suite?.name ?? '');
    setDescription(suite?.description ?? '');
    setKind(suite?.kind ?? 'static');
    setTagIds(suite?.tagIds ?? []);
    setPicked(suite?.kind === 'static' ? suite.tests.map((test) => key(test.type, test.id)) : []);
    setFilter('');
  }, [isOpen, suite]);

  const { data: uiTests = [] } = useQuery<NamedRow[]>({
    queryKey: ['/api/tests'],
    queryFn: () => getJson('/api/tests', 'the tests'),
    enabled: isOpen,
  });
  const { data: apiTests = [] } = useQuery<NamedRow[]>({
    queryKey: ['apiTests'],
    queryFn: () => getJson('/api/api-tests', 'the API tests'),
    enabled: isOpen,
  });
  const { data: allTags = [] } = useQuery<TagRow[]>({
    queryKey: ['tags'],
    queryFn: () => getJson('/api/tags', 'the tags'),
    enabled: isOpen,
  });

  const candidates = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = [
      ...(Array.isArray(uiTests) ? uiTests : []).map((test) => ({ type: 'ui' as const, id: test.id, name: test.name })),
      ...(Array.isArray(apiTests) ? apiTests : []).map((test) => ({ type: 'api' as const, id: test.id, name: test.name })),
    ];
    return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
  }, [uiTests, apiTests, filter]);

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const valid = name.trim().length > 0 && (kind === 'static' || tagIds.length > 0);

  const submit = () => {
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      kind,
      projectId: suite?.projectId ?? null,
      tagIds: kind === 'dynamic' ? tagIds : [],
      // In the order they were picked: that is the order they run in.
      items:
        kind === 'static'
          ? picked.map((entry) => {
              const [type, id] = entry.split(':');
              return { type: type as 'ui' | 'api', id: Number(id) };
            })
          : [],
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{suite ? t('suites.dialog.editTitle', 'Edit suite') : t('suites.dialog.createTitle', 'New suite')}</DialogTitle>
          <DialogDescription>
            {t('suites.dialog.description', 'A suite is a list of tests kept once and included by as many plans as need it.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="suite-name">{t('suites.fields.name', 'Name')}</Label>
            <Input id="suite-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suite-description">{t('suites.fields.description', 'Description')}</Label>
            <Textarea id="suite-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-1">
            <Label>{t('suites.fields.kind', 'Kind')}</Label>
            <div className="flex gap-2">
              {(['static', 'dynamic'] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={kind === option ? 'default' : 'outline'}
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                >
                  {t(`suites.kind.${option}`, option === 'static' ? 'Static' : 'Dynamic')}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {kind === 'static'
                ? t('suites.kindHint.static', 'These tests, in the order you pick them.')
                : t('suites.kindHint.dynamic', 'Every test carrying all of the chosen tags, worked out when a run is created.')}
            </p>
          </div>

          {kind === 'static' ? (
            <div className="space-y-2">
              <Label htmlFor="suite-filter">{t('suites.fields.tests', 'Tests')} ({picked.length})</Label>
              <Input
                id="suite-filter"
                placeholder={t('suites.filterTests', 'Filter tests…')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="max-h-56 overflow-y-auto rounded border p-2 space-y-1" data-testid="suite-test-list">
                {candidates.length === 0 && <p className="text-sm text-muted-foreground">{t('suites.noTests', 'No tests.')}</p>}
                {candidates.map((test) => {
                  const id = key(test.type, test.id);
                  return (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={picked.includes(id)}
                        onCheckedChange={() => setPicked((current) => toggle(current, id))}
                        aria-label={test.name}
                      />
                      <span className="flex-1">{test.name}</span>
                      <Badge variant="outline">{test.type === 'ui' ? 'UI' : 'API'}</Badge>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t('suites.fields.tags', 'Tags (a test must carry all of them)')}</Label>
              <div className="flex flex-wrap gap-3 rounded border p-2" data-testid="suite-tag-list">
                {allTags.length === 0 && <p className="text-sm text-muted-foreground">{t('suites.noTags', 'No tags yet: add them from the test library.')}</p>}
                {allTags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={tagIds.includes(tag.id)} onCheckedChange={() => setTagIds((current) => toggle(current, tag.id))} aria-label={tag.name} />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {suite && (
            <div className="space-y-1" data-testid="suite-preview">
              <Label>{t('suites.preview', 'Runs right now')} ({suite.tests.length})</Label>
              <ul className="text-sm text-muted-foreground list-disc pl-5 max-h-32 overflow-y-auto">
                {suite.tests.map((test) => (
                  <li key={key(test.type, test.id)}>{test.name ?? t('suites.hiddenTest', 'A test in a project you cannot see')}</li>
                ))}
              </ul>
              {suite.plans.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('suites.includedBy', 'Included by: {{plans}}', { plans: suite.plans.map((p) => p.name).join(', ') })}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('suites.cancel', 'Cancel')}
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('suites.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
