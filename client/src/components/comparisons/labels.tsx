import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type {
  ComparisonResultVerdict,
  ComparisonStatus,
  ComparisonVerdict,
} from '@shared/comparison';

/** How the comparison pages name a status and a verdict, in one place. */

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

const STATUS_FALLBACK: Record<ComparisonStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  comparing: 'Comparing',
  completed: 'Completed',
  error: 'Error',
  cancelled: 'Cancelled',
};

const VERDICT_FALLBACK: Record<ComparisonVerdict, string> = {
  regressions: 'Regressions',
  inconclusive: 'Inconclusive',
  parity_with_accepted: 'Parity with accepted differences',
  parity: 'Parity',
};

export const RESULT_VERDICT_FALLBACK: Record<ComparisonResultVerdict, string> = {
  identical: 'Identical',
  equivalent: 'Equivalent',
  different: 'Different',
  outcome_mismatch: 'Outcome differs',
  both_failed: 'Failed on both',
  not_comparable: 'Not comparable',
};

const VERDICT_VARIANT: Record<ComparisonVerdict, Variant> = {
  regressions: 'destructive',
  inconclusive: 'outline',
  parity_with_accepted: 'secondary',
  parity: 'default',
};

const RESULT_VERDICT_VARIANT: Record<ComparisonResultVerdict, Variant> = {
  identical: 'secondary',
  equivalent: 'secondary',
  different: 'destructive',
  outcome_mismatch: 'destructive',
  both_failed: 'outline',
  not_comparable: 'outline',
};

export function StatusBadge({ status }: { status: ComparisonStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'error' ? 'destructive' : 'outline'}>
      {t(`comparisons.statuses.${status}`, STATUS_FALLBACK[status] ?? status)}
    </Badge>
  );
}

export function VerdictBadge({ verdict }: { verdict: ComparisonVerdict | null }) {
  const { t } = useTranslation();
  if (!verdict) return null;
  return (
    <Badge variant={VERDICT_VARIANT[verdict] ?? 'outline'}>
      {t(`comparisons.verdicts.${verdict}`, VERDICT_FALLBACK[verdict] ?? verdict)}
    </Badge>
  );
}

export function ResultVerdictBadge({ verdict }: { verdict: ComparisonResultVerdict }) {
  const { t } = useTranslation();
  return (
    <Badge variant={RESULT_VERDICT_VARIANT[verdict] ?? 'outline'}>
      {t(`comparisons.resultVerdicts.${verdict}`, RESULT_VERDICT_FALLBACK[verdict] ?? verdict)}
    </Badge>
  );
}
