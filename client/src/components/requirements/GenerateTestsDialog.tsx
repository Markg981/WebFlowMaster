import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';

/**
 * Test cases proposed from a story, to read, correct and keep.
 *
 * The model's cases arrive editable and ticked; the author changes what is wrong, unticks what
 * is not wanted, and only then are they created, as manual tests linked to the story. Nothing is
 * created from the model's answer as it came.
 */

type Kind = 'positive' | 'negative' | 'edge';

interface Proposal {
  title: string;
  kind: Kind;
  criterion: string;
  preconditions: string;
  steps: Array<{ action: string; expected: string }>;
}

interface Draft extends Proposal {
  chosen: boolean;
}

interface Story {
  key: string;
  title: string;
  description: string;
  acceptance: string;
}

interface Props {
  requirement: { id: number; key: string; title: string } | null;
  onClose: () => void;
  onCreated: (count: number) => void;
}

const LANGUAGES = ['en', 'it', 'de', 'fr'];

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: json };
}

export default function GenerateTestsDialog({ requirement, onClose, onCreated }: Props) {
  const { t, i18n } = useTranslation();
  const [count, setCount] = useState('6');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [story, setStory] = useState<{ story: Story; source: 'tracker' | 'requirement' } | null>(null);
  const [busy, setBusy] = useState<'propose' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<string[]>([]);

  useEffect(() => {
    setDrafts(null);
    setStory(null);
    setError(null);
    setTaken([]);
  }, [requirement]);

  const kindLabel = (kind: Kind) =>
    ({
      positive: t('generateTests.kind.positive', 'Main path'),
      negative: t('generateTests.kind.negative', 'Error'),
      edge: t('generateTests.kind.edge', 'Limit'),
    })[kind];

  const propose = async () => {
    setBusy('propose');
    setError(null);
    setTaken([]);
    const language = (i18n.language ?? 'en').slice(0, 2);
    const answer = await post(`/api/requirements/${requirement!.id}/test-proposals`, {
      language: LANGUAGES.includes(language) ? language : 'en',
      count: Math.min(Math.max(Number(count) || 6, 1), 12),
    }).catch((e) => ({ ok: false, status: 0, body: { error: String(e?.message ?? e) } }));
    setBusy(null);
    if (!answer.ok) return setError(answer.body.error || t('generateTests.proposeFailed', 'No tests could be proposed.'));
    setStory({ story: answer.body.story, source: answer.body.source });
    setDrafts((answer.body.proposals as Proposal[]).map((p) => ({ ...p, chosen: true })));
  };

  const update = (index: number, patch: Partial<Draft>) => setDrafts((current) => current!.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const updateStep = (index: number, stepIndex: number, patch: Partial<{ action: string; expected: string }>) =>
    update(index, { steps: drafts![index].steps.map((s, i) => (i === stepIndex ? { ...s, ...patch } : s)) });

  const chosen = (drafts ?? []).filter((d) => d.chosen);

  const create = async () => {
    const payload = chosen.map((d) => ({
      name: d.title.trim(),
      steps: [
        // The preconditions go first, as a step the tester reads before starting.
        ...(d.preconditions.trim() ? [{ action: t('generateTests.preconditionsStep', 'Preconditions: {{text}}', { text: d.preconditions.trim() }), expected: '' }] : []),
        ...d.steps.map((s) => ({ action: s.action.trim(), expected: s.expected.trim() })).filter((s) => s.action),
      ],
    }));
    if (payload.some((p) => !p.name)) return setError(t('generateTests.nameMissing', 'Every chosen test needs a name.'));
    if (payload.some((p) => p.steps.length === 0)) return setError(t('generateTests.stepsMissing', 'Every chosen test needs at least one step.'));
    setBusy('create');
    setError(null);
    const answer = await post(`/api/requirements/${requirement!.id}/generated-tests`, { tests: payload }).catch((e) => ({
      ok: false,
      status: 0,
      body: { error: String(e?.message ?? e) },
    }));
    setBusy(null);
    if (!answer.ok) {
      setTaken(Array.isArray(answer.body.names) ? answer.body.names : []);
      return setError(answer.body.error || t('generateTests.createFailed', 'The tests were not created.'));
    }
    onCreated(answer.body.created.length);
  };

  return (
    <Dialog open={requirement !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t('generateTests.title', 'Tests for {{key}}', { key: requirement?.key ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'generateTests.description',
              'An AI model reads the story and its acceptance criteria and proposes test cases. Correct them, keep the ones you want, and they become manual tests linked to the story.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="generateCount">{t('generateTests.count', 'How many at most')}</Label>
            <Input id="generateCount" type="number" min={1} max={12} className="mt-1 w-24" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <Button onClick={propose} disabled={busy !== null} variant={drafts ? 'outline' : 'default'}>
            {busy === 'propose' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {drafts ? t('generateTests.again', 'Propose again') : t('generateTests.propose', 'Propose tests')}
          </Button>
          {busy === 'propose' && (
            <p className="text-sm text-muted-foreground" role="status">
              {t('generateTests.reading', 'Reading the story and writing test cases… this can take a minute.')}
            </p>
          )}
        </div>

        {story && (
          <details className="text-sm rounded border p-2">
            <summary className="cursor-pointer">
              {story.source === 'tracker'
                ? t('generateTests.fromTracker', 'Written from {{key}} as the tracker has it now', { key: story.story.key })
                : t('generateTests.fromRequirement', 'Written from the description of {{key}}', { key: story.story.key })}
            </summary>
            <p className="mt-2 font-medium">{story.story.title}</p>
            {story.story.description && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{story.story.description}</p>}
            {story.story.acceptance && (
              <>
                <p className="mt-2 font-medium">{t('generateTests.acceptance', 'Acceptance criteria')}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{story.story.acceptance}</p>
              </>
            )}
          </details>
        )}

        {drafts?.map((draft, index) => (
          <div key={index} className={`rounded-md border p-3 space-y-2 ${draft.chosen ? '' : 'opacity-60'}`} data-testid={`proposal-${index}`}>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={draft.chosen}
                onCheckedChange={(checked) => update(index, { chosen: !!checked })}
                aria-label={t('generateTests.keep', 'Keep {{name}}', { name: draft.title })}
              />
              <Input
                value={draft.title}
                onChange={(e) => update(index, { title: e.target.value })}
                className={taken.includes(draft.title.trim()) ? 'border-destructive' : ''}
                aria-label={t('generateTests.name', 'Name of test {{n}}', { n: index + 1 })}
              />
              <Badge variant={draft.kind === 'positive' ? 'secondary' : 'outline'} className="shrink-0">
                {kindLabel(draft.kind)}
              </Badge>
            </div>
            {draft.criterion && (
              <p className="text-xs text-muted-foreground">{t('generateTests.covers', 'Covers: {{criterion}}', { criterion: draft.criterion })}</p>
            )}
            <Textarea
              rows={1}
              value={draft.preconditions}
              placeholder={t('generateTests.preconditions', 'Preconditions')}
              onChange={(e) => update(index, { preconditions: e.target.value })}
              aria-label={t('generateTests.preconditionsOf', 'Preconditions of test {{n}}', { n: index + 1 })}
            />
            <ol className="space-y-1">
              {draft.steps.map((step, stepIndex) => (
                <li key={stepIndex} className="flex items-start gap-2">
                  <span className="text-xs text-muted-foreground w-5 pt-2">{stepIndex + 1}.</span>
                  <Input
                    value={step.action}
                    onChange={(e) => updateStep(index, stepIndex, { action: e.target.value })}
                    placeholder={t('generateTests.action', 'Action')}
                    aria-label={t('generateTests.actionOf', 'Action {{step}} of test {{n}}', { step: stepIndex + 1, n: index + 1 })}
                  />
                  <Input
                    value={step.expected}
                    onChange={(e) => updateStep(index, stepIndex, { expected: e.target.value })}
                    placeholder={t('generateTests.expected', 'Expected result')}
                    aria-label={t('generateTests.expectedOf', 'Expected result {{step}} of test {{n}}', { step: stepIndex + 1, n: index + 1 })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update(index, { steps: draft.steps.filter((_, i) => i !== stepIndex) })}
                    aria-label={t('generateTests.removeStep', 'Remove step {{step}} of test {{n}}', { step: stepIndex + 1, n: index + 1 })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ol>
            <Button variant="ghost" size="sm" onClick={() => update(index, { steps: [...draft.steps, { action: '', expected: '' }] })}>
              <Plus className="mr-1 h-4 w-4" /> {t('generateTests.addStep', 'Add step')}
            </Button>
          </div>
        ))}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('generateTests.cancel', 'Cancel')}
          </Button>
          {drafts && (
            <Button onClick={create} disabled={busy !== null || chosen.length === 0}>
              {busy === 'create' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('generateTests.create', 'Create {{count}} tests', { count: chosen.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
