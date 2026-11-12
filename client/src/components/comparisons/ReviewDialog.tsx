import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { reviewComparisonResult, type ComparisonResultDetail } from '@/lib/api/comparisons';
import {
  COMPARISON_REVIEW_STATUSES,
  MAX_KNOWN_DIFFERENCES_PER_REVIEW,
  type ComparisonReviewStatus,
  type KnownDifferenceScope,
} from '@shared/comparison';

/**
 * The review of one test of a comparison: open, accepted (the difference is expected, and the
 * note says why) or a defect. An accepted test can also teach later comparisons: the chosen
 * differences are saved as known, for this test, its project or the whole organization, and
 * the next comparison marks them as expected instead of calling the test different.
 */

const STATUS_FALLBACK: Record<ComparisonReviewStatus, string> = {
  open: 'To review',
  accepted: 'Accepted: the difference is expected',
  defect: 'Defect: the candidate is wrong',
};

/** The end of the chosen day in the viewer's time zone, as the ISO instant the server wants. */
export const endOfDay = (date: string) => new Date(`${date}T23:59:59`).toISOString();

export default function ReviewDialog({
  comparisonId,
  result,
  onClose,
  onReviewed,
}: {
  comparisonId: string;
  result: ComparisonResultDetail | null;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ComparisonReviewStatus>('accepted');
  const [note, setNote] = useState('');
  const [save, setSave] = useState(false);
  const [scope, setScope] = useState<KnownDifferenceScope>('test');
  const [reference, setReference] = useState('');
  const [expires, setExpires] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** What can be saved as known: the blocking differences no known difference covers yet. */
  const savable = useMemo(
    () =>
      (result?.differences ?? [])
        .map((difference, index) => ({ difference, index }))
        .filter(
          ({ difference }) => difference.severity === 'blocking' && !difference.knownDifferenceId,
        )
        .slice(0, MAX_KNOWN_DIFFERENCES_PER_REVIEW),
    [result],
  );

  useEffect(() => {
    if (!result) return;
    setStatus(result.reviewStatus === 'open' ? 'accepted' : result.reviewStatus);
    setNote(result.reviewNote ?? '');
    setSave(false);
    setScope(result.uiTestId ? 'test' : 'organization');
    setReference('');
    setExpires('');
    setChosen(new Set(savable.map(({ index }) => index)));
    setError('');
  }, [result, savable]);

  const canSave = status === 'accepted' && savable.length > 0;
  const needsNote = status === 'accepted' && note.trim() === '';
  const ready = !needsNote && !(save && canSave && chosen.size === 0);

  const submit = async () => {
    if (!result || !ready) return;
    setBusy(true);
    setError('');
    try {
      await reviewComparisonResult(comparisonId, result.id, {
        status,
        note: note.trim() || undefined,
        saveAsKnownDifference:
          save && canSave
            ? {
                scope,
                reference: reference.trim() || undefined,
                expiresAt: expires ? endOfDay(expires) : undefined,
                differences: [...chosen].sort((a, b) => a - b),
              }
            : undefined,
      });
      onReviewed();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (index: number, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('comparisons.review.title', 'Review “{{name}}”', { name: result?.testName ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'comparisons.review.description',
              'Say whether the differences are expected. An accepted test can teach later comparisons to expect them.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup
            value={status}
            onValueChange={(value) => setStatus(value as ComparisonReviewStatus)}
            aria-label={t('comparisons.review.status', 'Review')}
          >
            {COMPARISON_REVIEW_STATUSES.map((value) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem id={`review-${value}`} value={value} />
                <Label htmlFor={`review-${value}`} className="font-normal">
                  {t(`comparisons.review.statuses.${value}`, STATUS_FALLBACK[value])}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-1">
            <Label htmlFor="review-note">
              {status === 'accepted'
                ? t('comparisons.review.reason', 'Why it is expected')
                : t('comparisons.review.note', 'Note (optional)')}
            </Label>
            <Textarea
              id="review-note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {needsNote && (
              <p className="text-xs text-muted-foreground">
                {t('comparisons.review.reasonRequired', 'Accepting a difference needs a reason.')}
              </p>
            )}
          </div>
          {canSave && (
            <div className="space-y-3 border rounded p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="review-save"
                  checked={save}
                  onCheckedChange={(value) => setSave(value === true)}
                />
                <Label htmlFor="review-save" className="font-normal">
                  {t(
                    'comparisons.review.saveAsKnown',
                    'Expect these differences in later comparisons',
                  )}
                </Label>
              </div>
              {save && (
                <>
                  <ul className="space-y-1 max-h-40 overflow-auto" data-testid="review-differences">
                    {savable.map(({ difference, index }) => (
                      <li key={index} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          id={`review-difference-${index}`}
                          checked={chosen.has(index)}
                          onCheckedChange={(value) => toggle(index, value === true)}
                        />
                        <Label htmlFor={`review-difference-${index}`} className="font-normal">
                          {t(`comparisons.kinds.${difference.kind}`, difference.kind)}
                          {difference.checkpoint ? ` “${difference.checkpoint}”` : ''}
                          {difference.path ? (
                            <code className="ml-1 text-muted-foreground">{difference.path}</code>
                          ) : null}
                        </Label>
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-1">
                    <Label htmlFor="review-scope">
                      {t('comparisons.review.scope', 'Where to expect them')}
                    </Label>
                    <Select
                      value={scope}
                      onValueChange={(value) => setScope(value as KnownDifferenceScope)}
                    >
                      <SelectTrigger
                        id="review-scope"
                        aria-label={t('comparisons.review.scope', 'Where to expect them')}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {result?.uiTestId && (
                          <SelectItem value="test">
                            {t('comparisons.scopes.test', 'This test')}
                          </SelectItem>
                        )}
                        <SelectItem value="project">
                          {t('comparisons.scopes.project', 'Every test of its project')}
                        </SelectItem>
                        <SelectItem value="organization">
                          {t('comparisons.scopes.organization', 'Every test of the organization')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2 grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="review-reference">
                        {t('comparisons.review.reference', 'Reference (optional)')}
                      </Label>
                      <Input
                        id="review-reference"
                        maxLength={500}
                        value={reference}
                        placeholder={t(
                          'comparisons.review.referencePlaceholder',
                          'e.g. ticket 1234',
                        )}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="review-expires">
                        {t('comparisons.review.expires', 'Expires (optional)')}
                      </Label>
                      <Input
                        id="review-expires"
                        type="date"
                        value={expires}
                        onChange={(e) => setExpires(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('comparisons.review.save', 'Save review')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
