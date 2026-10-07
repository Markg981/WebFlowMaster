import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LOAD_LIMITS,
  loadTestSchema,
  peakVus,
  totalDurationSec,
  type LoadDataMode,
  type LoadStage,
  type LoadStep,
  type LoadThresholds,
} from '@shared/load-test';
import { LoadProfileChart } from './LoadProfileChart';

/**
 * Writing a load test (shared/load-test.ts): the API tests a virtual user repeats, the stages the
 * number of users follows, the warm-up left out of the verdict, the data each user reads and the
 * thresholds the run is judged on.
 */

export interface LoadTestRow {
  id: number;
  name: string;
  description: string | null;
  projectId: number | null;
  steps: LoadStep[];
  stages: LoadStage[];
  warmUpSec: number;
  dataSetId: number | null;
  dataMode: LoadDataMode;
  thresholds: LoadThresholds;
}

type Draft = Omit<LoadTestRow, 'id'>;

const NO_DATA = 'none';

export const EMPTY_LOAD_TEST: Draft = {
  name: '',
  description: null,
  projectId: null,
  steps: [],
  stages: [
    { durationSec: 60, targetVus: 10 },
    { durationSec: 300, targetVus: 10 },
    { durationSec: 60, targetVus: 0 },
  ],
  warmUpSec: 30,
  dataSetId: null,
  dataMode: 'vu',
  thresholds: { p95Ms: 1000, errorRatePct: 1 },
};

const int = (raw: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(raw) || 0)));

interface Props {
  isOpen: boolean;
  test: LoadTestRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function LoadTestDialog({ isOpen, test, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(EMPTY_LOAD_TEST);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // Only the fields the form edits: a listed row also carries its id and its last run.
    setDraft(
      test
        ? {
            name: test.name,
            description: test.description,
            projectId: test.projectId,
            steps: test.steps,
            stages: test.stages,
            warmUpSec: test.warmUpSec,
            dataSetId: test.dataSetId,
            dataMode: test.dataMode,
            thresholds: test.thresholds ?? {},
          }
        : EMPTY_LOAD_TEST,
    );
    setError(null);
  }, [isOpen, test]);

  const { data: apiTests = [] } = useQuery<Array<{ id: number; name: string; method: string; url: string }>>({
    queryKey: ['apiTests'],
    queryFn: async () => {
      const response = await fetch('/api/api-tests', { credentials: 'include' });
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
    enabled: isOpen,
  });
  const { data: dataSets = [] } = useQuery<Array<{ id: number; name: string; columns: string[]; rows: unknown[] }>>({
    queryKey: ['testData'],
    queryFn: async () => {
      const response = await fetch('/api/test-data', { credentials: 'include' });
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
    enabled: isOpen,
  });
  const nameOf = (id: number) => apiTests.find((api) => api.id === id)?.name ?? `#${id}`;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setStep = (index: number, step: LoadStep) => set('steps', draft.steps.map((s, i) => (i === index ? step : s)));
  const moveStep = (index: number, by: number) => {
    const steps = [...draft.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + by, 0, step);
    set('steps', steps);
  };
  const setStage = (index: number, stage: LoadStage) => set('stages', draft.stages.map((s, i) => (i === index ? stage : s)));
  const setThreshold = (key: keyof LoadThresholds, raw: string) => {
    const thresholds = { ...draft.thresholds };
    if (raw.trim() === '') delete thresholds[key];
    else thresholds[key] = key === 'errorRatePct' ? Math.min(100, Math.max(0, Number(raw))) : key === 'minRps' ? Math.max(0.1, Number(raw)) : Math.max(1, Math.round(Number(raw)));
    set('thresholds', thresholds);
  };

  const total = totalDurationSec(draft.stages);
  const peak = peakVus(draft.stages);
  const dataSet = dataSets.find((s) => s.id === draft.dataSetId);

  const save = async () => {
    const parsed = loadTestSchema.safeParse(draft);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t('loadTests.invalid', 'The load test is not valid.'));
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(test ? `/api/load-tests/${test.id}` : '/api/load-tests', {
        method: test ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t('loadTests.saveFailed', 'The load test was not saved.'));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const thresholdFields: Array<{ key: keyof LoadThresholds; label: string; unit: string }> = [
    { key: 'p50Ms', label: t('loadTests.thresholds.p50', 'Median (p50)'), unit: 'ms' },
    { key: 'p95Ms', label: t('loadTests.thresholds.p95', '95th percentile (p95)'), unit: 'ms' },
    { key: 'p99Ms', label: t('loadTests.thresholds.p99', '99th percentile (p99)'), unit: 'ms' },
    { key: 'maxMs', label: t('loadTests.thresholds.max', 'Slowest'), unit: 'ms' },
    { key: 'errorRatePct', label: t('loadTests.thresholds.errorRate', 'Failed requests'), unit: '%' },
    { key: 'minRps', label: t('loadTests.thresholds.minRps', 'Minimum throughput'), unit: 'req/s' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{test ? t('loadTests.editTitle', 'Edit load test') : t('loadTests.createTitle', 'New load test')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="load-name">{t('loadTests.name', 'Name')}</Label>
              <Input id="load-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="load-description">{t('loadTests.description', 'Description')}</Label>
              <Textarea id="load-description" rows={1} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('loadTests.scenario', 'Scenario')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('loadTests.scenarioHelp', 'Each virtual user runs these API tests in order, again and again. What a test captures is sent by the next ones; a failed test ends the iteration.')}
            </p>
            {draft.steps.map((step, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2" data-testid={`load-step-${index}`}>
                <span className="w-6 text-right text-sm text-muted-foreground">{index + 1}.</span>
                <span className="min-w-[12rem] flex-1 truncate text-sm font-medium">{nameOf(step.apiTestId)}</span>
                <Label htmlFor={`load-think-${index}`} className="text-xs text-muted-foreground">
                  {t('loadTests.thinkTime', 'Pause after (ms)')}
                </Label>
                <Input
                  id={`load-think-${index}`}
                  type="number"
                  className="w-24"
                  min={0}
                  max={LOAD_LIMITS.thinkTimeMs}
                  value={step.thinkTimeMs}
                  onChange={(e) => setStep(index, { ...step, thinkTimeMs: int(e.target.value, 0, LOAD_LIMITS.thinkTimeMs) })}
                />
                <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label={t('loadTests.moveUp', 'Move up')}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)} aria-label={t('loadTests.moveDown', 'Move down')}><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => set('steps', draft.steps.filter((_, i) => i !== index))} aria-label={t('loadTests.removeStep', 'Remove {{name}}', { name: nameOf(step.apiTestId) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {draft.steps.length < LOAD_LIMITS.steps && (
              <Select value="" onValueChange={(id) => set('steps', [...draft.steps, { apiTestId: Number(id), thinkTimeMs: 0 }])}>
                <SelectTrigger className="sm:max-w-md" aria-label={t('loadTests.addStep', 'Add an API test')}>
                  <SelectValue placeholder={t('loadTests.addStep', 'Add an API test')} />
                </SelectTrigger>
                <SelectContent>
                  {apiTests.map((api) => (
                    <SelectItem key={api.id} value={String(api.id)}>{`${api.name} · ${api.method}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('loadTests.profile', 'Load profile')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('loadTests.profileHelp', 'Each stage moves the number of virtual users from where the previous one ended (0 at the start) to its target, over its duration. Same target: the load is held.')}
            </p>
            {draft.stages.map((stage, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2" data-testid={`load-stage-${index}`}>
                <span className="w-6 text-right text-sm text-muted-foreground">{index + 1}.</span>
                <Label htmlFor={`load-stage-duration-${index}`} className="text-xs">{t('loadTests.stageDuration', 'Duration (s)')}</Label>
                <Input id={`load-stage-duration-${index}`} type="number" className="w-24" min={1} max={LOAD_LIMITS.durationSec} value={stage.durationSec}
                  onChange={(e) => setStage(index, { ...stage, durationSec: int(e.target.value, 1, LOAD_LIMITS.durationSec) })} />
                <Label htmlFor={`load-stage-target-${index}`} className="text-xs">{t('loadTests.stageTarget', 'Virtual users')}</Label>
                <Input id={`load-stage-target-${index}`} type="number" className="w-24" min={0} max={LOAD_LIMITS.virtualUsers} value={stage.targetVus}
                  onChange={(e) => setStage(index, { ...stage, targetVus: int(e.target.value, 0, LOAD_LIMITS.virtualUsers) })} />
                <Button variant="ghost" size="sm" disabled={draft.stages.length === 1} onClick={() => set('stages', draft.stages.filter((_, i) => i !== index))} aria-label={t('loadTests.removeStage', 'Remove stage {{n}}', { n: index + 1 })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {draft.stages.length < LOAD_LIMITS.stages && (
              <Button variant="outline" size="sm" onClick={() => set('stages', [...draft.stages, { durationSec: 60, targetVus: draft.stages[draft.stages.length - 1]?.targetVus ?? 1 }])}>
                <Plus className="mr-1 h-4 w-4" /> {t('loadTests.addStage', 'Add a stage')}
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="load-warmup" className="text-xs">{t('loadTests.warmUp', 'Warm-up (s), not judged')}</Label>
              <Input id="load-warmup" type="number" className="w-24" min={0} max={LOAD_LIMITS.durationSec} value={draft.warmUpSec}
                onChange={(e) => set('warmUpSec', int(e.target.value, 0, LOAD_LIMITS.durationSec))} />
              <span className="text-xs text-muted-foreground">
                {t('loadTests.profileTotal', '{{total}} s in all, {{peak}} virtual users at the peak', { total, peak })}
              </span>
            </div>
            <LoadProfileChart stages={draft.stages} warmUpSec={draft.warmUpSec} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('loadTests.data', 'Data per virtual user')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={draft.dataSetId ? String(draft.dataSetId) : NO_DATA} onValueChange={(v) => set('dataSetId', v === NO_DATA ? null : Number(v))}>
                <SelectTrigger className="w-60" aria-label={t('loadTests.dataSet', 'Data set')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DATA}>{t('loadTests.noData', 'No data set: the same values for everyone')}</SelectItem>
                  {dataSets.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{t('loadTests.dataSetOption', '{{name}} ({{rows}} rows)', { name: s.name, rows: s.rows.length })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draft.dataSetId && (
                <Select value={draft.dataMode} onValueChange={(v) => set('dataMode', v as LoadDataMode)}>
                  <SelectTrigger className="w-72" aria-label={t('loadTests.dataMode', 'How rows are handed out')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vu">{t('loadTests.dataModeVu', 'A row of its own for each virtual user')}</SelectItem>
                    <SelectItem value="iteration">{t('loadTests.dataModeIteration', 'The next row on every iteration')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {dataSet
                ? t('loadTests.dataHelp', 'The API tests read the row as {{example}}; {{vu}} and {{iteration}} number the user and its iteration.', {
                    example: `{{data.${dataSet.name}.${dataSet.columns[0] ?? 'column'}}}`,
                    vu: '{{load.vu}}',
                    iteration: '{{load.iteration}}',
                    interpolation: { escapeValue: false },
                  })
                : t('loadTests.dataNone', 'Every virtual user sends the same values; {{vu}} and {{iteration}} still tell them apart.', {
                    vu: '{{load.vu}}',
                    iteration: '{{load.iteration}}',
                    interpolation: { escapeValue: false },
                  })}
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('loadTests.thresholdsTitle', 'Thresholds')}</h3>
            <p className="text-xs text-muted-foreground">{t('loadTests.thresholdsHelp', 'Judged on the requests after the warm-up. Empty: not checked.')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {thresholdFields.map(({ key, label, unit }) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`load-threshold-${key}`} className="text-xs">{`${label} (${unit})`}</Label>
                  <Input id={`load-threshold-${key}`} type="number" min={0} value={draft.thresholds[key] ?? ''} onChange={(e) => setThreshold(key, e.target.value)} />
                </div>
              ))}
            </div>
          </section>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('loadTests.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving}>{t('loadTests.save', 'Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
