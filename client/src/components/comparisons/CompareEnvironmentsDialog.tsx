import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import PolicyEditor, { defaultPolicy } from '@/components/comparisons/PolicyEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnvironments } from '@/hooks/use-environments';
import { newIdempotencyKey, startComparison } from '@/lib/api/comparisons';
import {
  ComparisonUrlSchema,
  comparisonSidesDiffer,
  type ComparisonMode,
  type ComparisonPolicy,
} from '@shared/comparison';

/** The environment picker's "no environment" entry: a Select item cannot have an empty value. */
const NONE = 'none';

/** A URL field's value: null when empty, the normalized address when valid, undefined when not. */
function urlOf(value: string): string | null | undefined {
  if (value.trim() === '') return null;
  const parsed = ComparisonUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Starts a comparison of one plan on two sides: the plan runs on the baseline, then the same
 * frozen tests replay on the candidate, and the report pairs their results.
 *
 * Each side is an environment, a URL, or both (docs/superpowers/specs/2026-11-16-comparison-urls-design.md):
 * a URL is where that version answers, and the other version's addresses in the tests become it.
 * A candidate without an environment runs with the baseline's. The two sides must differ; the
 * server says so too, the dialog only spares the trip.
 */
export default function CompareEnvironmentsDialog({
  plan,
  onClose,
}: {
  plan: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { data: environments = [], isLoading } = useEnvironments({ enabled: plan !== null });
  const [baseline, setBaseline] = useState(NONE);
  const [candidate, setCandidate] = useState(NONE);
  const [baselineUrl, setBaselineUrl] = useState('');
  const [candidateUrl, setCandidateUrl] = useState('');
  const [recordedUrl, setRecordedUrl] = useState('');
  const [mode, setMode] = useState<ComparisonMode>('sequential');
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<ComparisonPolicy>(defaultPolicy);
  const [showPolicy, setShowPolicy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One key per opening: a double click or a retry after a timeout starts one comparison.
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (plan === null) return;
    setBaseline(NONE);
    setCandidate(NONE);
    setBaselineUrl('');
    setCandidateUrl('');
    setRecordedUrl('');
    setMode('sequential');
    setName('');
    setPolicy(defaultPolicy());
    setShowPolicy(false);
    setError('');
    setKey(newIdempotencyKey());
  }, [plan]);

  const environmentOf = (value: string) => (value === NONE ? null : Number(value));
  const urls = {
    baseline: urlOf(baselineUrl),
    candidate: urlOf(candidateUrl),
    recorded: urlOf(recordedUrl),
  };
  const body = {
    baselineEnvironmentId: environmentOf(baseline),
    candidateEnvironmentId: environmentOf(candidate),
    baselineUrl: urls.baseline ?? null,
    candidateUrl: urls.candidate ?? null,
    recordedUrl: urls.recorded ?? null,
  };
  const badUrl = Object.values(urls).some((url) => url === undefined);
  const baselineSet = body.baselineEnvironmentId !== null || body.baselineUrl !== null;
  const candidateSet = body.candidateEnvironmentId !== null || body.candidateUrl !== null;
  const same = baselineSet && candidateSet && !badUrl && !comparisonSidesDiffer(body);
  const recordedAlone = body.recordedUrl !== null && (!body.baselineUrl || !body.candidateUrl);
  const ready = baselineSet && candidateSet && !badUrl && !same && !recordedAlone;

  const submit = async () => {
    if (!plan || !ready) return;
    setBusy(true);
    setError('');
    try {
      const created = await startComparison(
        plan.id,
        { ...body, mode, name: name.trim() || undefined, policy },
        key,
      );
      onClose();
      navigate(`/comparisons/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Both sides have an "Environment" and a "URL": the side's name tells them apart to a screen reader.
  const picker = (
    id: string,
    sideLabel: string,
    value: string,
    onChange: (value: string) => void,
    noneLabel: string,
  ) => {
    const label = t('comparisons.dialog.environment', 'Environment');
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Select value={value} onValueChange={onChange} disabled={isLoading}>
          <SelectTrigger id={id} aria-label={`${sideLabel}: ${label}`}>
            <SelectValue placeholder={t('comparisons.dialog.pick', 'Choose an environment')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{noneLabel}</SelectItem>
            {environments.map((environment) => (
              <SelectItem key={environment.id} value={String(environment.id)}>
                {environment.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const urlField = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    help: string,
    ariaLabel?: string,
  ) => {
    const invalid = urlOf(value) === undefined;
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="url"
          inputMode="url"
          value={value}
          maxLength={2048}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://"
          aria-invalid={invalid}
          aria-label={ariaLabel}
        />
        <p className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
          {invalid
            ? t('comparisons.dialog.badUrl', 'An http or https address, without a user name.')
            : help}
        </p>
      </div>
    );
  };

  const side = (
    role: 'baseline' | 'candidate',
    label: string,
    value: string,
    onChange: (value: string) => void,
    url: string,
    onUrlChange: (value: string) => void,
  ) => (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      {picker(
        `comparison-${role}`,
        label,
        value,
        onChange,
        role === 'candidate'
          ? t('comparisons.dialog.sameAsBaseline', "None: the baseline's")
          : t('comparisons.dialog.noEnvironment', 'None'),
      )}
      {urlField(
        `comparison-${role}-url`,
        t('comparisons.dialog.url', 'URL'),
        url,
        onUrlChange,
        role === 'baseline'
          ? t('comparisons.dialog.baselineUrlHelp', 'Where the old version answers.')
          : t('comparisons.dialog.candidateUrlHelp', 'Where the new version answers.'),
        `${label}: ${t('comparisons.dialog.url', 'URL')}`,
      )}
    </fieldset>
  );

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('comparisons.dialog.title', 'Compare environments: {{name}}', {
              name: plan?.name ?? '',
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'comparisons.dialog.description',
              'The plan runs on the baseline, then the same tests replay on the candidate. The report shows, test by test, what differs.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {side(
            'baseline',
            t('comparisons.baseline', 'Baseline'),
            baseline,
            setBaseline,
            baselineUrl,
            setBaselineUrl,
          )}
          {side(
            'candidate',
            t('comparisons.candidate', 'Candidate'),
            candidate,
            setCandidate,
            candidateUrl,
            setCandidateUrl,
          )}
          {(!baselineSet || !candidateSet) && (
            <p className="text-xs text-muted-foreground">
              {t('comparisons.dialog.needSide', 'Give each side an environment, a URL, or both.')}
            </p>
          )}
          {same && (
            <p className="text-xs text-destructive">
              {t(
                'comparisons.dialog.same',
                'The two sides must differ: another environment or another URL.',
              )}
            </p>
          )}
          {urlField(
            'comparison-recorded-url',
            t('comparisons.dialog.recordedUrl', 'Address used in the tests (optional)'),
            recordedUrl,
            setRecordedUrl,
            t(
              'comparisons.dialog.recordedUrlHelp',
              'When the tests were recorded on a third address: it is replaced on both sides.',
            ),
          )}
          {recordedAlone && (
            <p className="text-xs text-destructive">
              {t(
                'comparisons.dialog.recordedNeedsUrls',
                'The address used in the tests needs a URL on both sides.',
              )}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="comparison-mode">{t('comparisons.dialog.mode', 'Order')}</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as ComparisonMode)}>
              <SelectTrigger
                id="comparison-mode"
                aria-label={t('comparisons.dialog.mode', 'Order')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequential">
                  {t('comparisons.modes.sequential', 'Baseline first, then candidate')}
                </SelectItem>
                <SelectItem value="parallel">
                  {t('comparisons.modes.parallel', 'Both at once')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="comparison-name">
              {t('comparisons.dialog.name', 'Name (optional)')}
            </Label>
            <Input
              id="comparison-name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('comparisons.dialog.namePlaceholder', 'e.g. Angular 22 upgrade')}
            />
          </div>
          <Collapsible open={showPolicy} onOpenChange={setShowPolicy}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0">
                {showPolicy ? (
                  <ChevronDown className="h-4 w-4 mr-1" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-1" />
                )}
                {t('comparisons.dialog.tolerances', 'Tolerances')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <PolicyEditor value={policy} onChange={setPolicy} />
            </CollapsibleContent>
          </Collapsible>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('comparisons.dialog.start', 'Start comparison')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
