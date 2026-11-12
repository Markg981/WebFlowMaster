import type { ComparisonDifference, ComparisonPolicy } from '@shared/comparison';
import { pairSteps, type ComparedStep } from './steps';

/** A slowdown smaller than this is noise, whatever its percentage: 20 ms against 40 ms is not one. */
export const MIN_SLOWDOWN_MS = 250;

/** The candidate slower than the baseline by more than the policy allows. */
export function isSlowdown(
  baselineMs: number,
  candidateMs: number,
  maxSlowdownPct: number,
): boolean {
  const delta = candidateMs - baselineMs;
  if (delta <= MIN_SLOWDOWN_MS) return false;
  return baselineMs <= 0 || (delta / baselineMs) * 100 > maxSlowdownPct;
}

const known = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The test and its steps slower on the candidate than `maxSlowdownPct` allows, with the severity
 * the policy gives them; nothing when the policy turns performance off. Faster is never a
 * difference. A step's duration counts only where the log records it.
 */
export function diffPerformance(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  durations: { baseline: number | null; candidate: number | null },
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  const { mode, maxSlowdownPct } = policy.performance;
  if (mode === 'off') return [];
  const out: ComparisonDifference[] = [];
  const test = durations;
  if (
    known(test.baseline) &&
    known(test.candidate) &&
    isSlowdown(test.baseline, test.candidate, maxSlowdownPct)
  )
    out.push({
      stepId: null,
      stepIndex: -1,
      checkpoint: null,
      kind: 'performance',
      path: 'duration',
      baseline: test.baseline,
      candidate: test.candidate,
      severity: mode,
    });
  for (const { baseline: a, candidate: b } of pairSteps(baseline, candidate)) {
    if (!a || !b || !known(a.durationMs) || !known(b.durationMs)) continue;
    if (!isSlowdown(a.durationMs, b.durationMs, maxSlowdownPct)) continue;
    out.push({
      stepId: a.stepId,
      stepIndex: a.index,
      checkpoint: null,
      kind: 'performance',
      path: 'duration',
      baseline: a.durationMs,
      candidate: b.durationMs,
      severity: mode,
    });
  }
  return out;
}
