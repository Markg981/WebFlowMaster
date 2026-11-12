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
import type { ComparisonMode, ComparisonPolicy } from '@shared/comparison';

/**
 * Starts a comparison of one plan on two environments: the plan runs on the baseline, then the
 * same frozen tests replay on the candidate, and the report pairs their results.
 *
 * The two environments must differ; the server says so too, the dialog only spares the trip.
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
  const [baseline, setBaseline] = useState('');
  const [candidate, setCandidate] = useState('');
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
    setBaseline('');
    setCandidate('');
    setMode('sequential');
    setName('');
    setPolicy(defaultPolicy());
    setShowPolicy(false);
    setError('');
    setKey(newIdempotencyKey());
  }, [plan]);

  const same = baseline !== '' && baseline === candidate;
  const ready = baseline !== '' && candidate !== '' && !same;

  const submit = async () => {
    if (!plan || !ready) return;
    setBusy(true);
    setError('');
    try {
      const created = await startComparison(
        plan.id,
        {
          baselineEnvironmentId: Number(baseline),
          candidateEnvironmentId: Number(candidate),
          mode,
          name: name.trim() || undefined,
          policy,
        },
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

  const picker = (id: string, label: string, value: string, onChange: (value: string) => void) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder={t('comparisons.dialog.pick', 'Choose an environment')} />
        </SelectTrigger>
        <SelectContent>
          {environments.map((environment) => (
            <SelectItem key={environment.id} value={String(environment.id)}>
              {environment.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
          {!isLoading && environments.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'comparisons.dialog.needTwo',
                'A comparison needs two environments. Add them in Settings → Environments.',
              )}
            </p>
          ) : (
            <>
              {picker(
                'comparison-baseline',
                t('comparisons.baseline', 'Baseline'),
                baseline,
                setBaseline,
              )}
              {picker(
                'comparison-candidate',
                t('comparisons.candidate', 'Candidate'),
                candidate,
                setCandidate,
              )}
              {same && (
                <p className="text-xs text-destructive">
                  {t('comparisons.dialog.same', 'Choose two different environments.')}
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
            </>
          )}
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
