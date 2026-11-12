import type {
  ComparisonDifference,
  ComparisonResultVerdict,
  ComparisonVerdict,
  VerdictCounts,
} from '@shared/comparison';

/** What a stored result status means for a comparison. */
export type OutcomeClass = 'passed' | 'failed' | 'not_run';

export function outcomeClassOf(status: string | null | undefined): OutcomeClass {
  if (status === 'Passed') return 'passed';
  if (status === 'Failed' || status === 'Error') return 'failed';
  return 'not_run';
}

/**
 * The verdict of one paired test (design, "Test verdict"). A side with no result, or one that was
 * skipped, leaves nothing to compare; a test that failed on both sides is not evidence either way.
 */
export function testVerdict(
  baselineStatus: string | null,
  candidateStatus: string | null,
  differences: ComparisonDifference[],
): ComparisonResultVerdict {
  const left = baselineStatus === null ? 'not_run' : outcomeClassOf(baselineStatus);
  const right = candidateStatus === null ? 'not_run' : outcomeClassOf(candidateStatus);
  if (left === 'not_run' || right === 'not_run') return 'not_comparable';
  if (left === 'failed' && right === 'failed') return 'both_failed';
  if (left !== right) return 'outcome_mismatch';
  if (differences.length === 0) return 'identical';
  return differences.some((d) => d.severity === 'blocking' && !d.knownDifferenceId)
    ? 'different'
    : 'equivalent';
}

/**
 * The overall verdict from the per-test counts, in the precedence of COMPARISON_VERDICTS. Two runs
 * with no test at all prove nothing, so they are inconclusive rather than at parity.
 */
export function overallVerdict(counts: VerdictCounts): ComparisonVerdict {
  if (Object.values(counts).every((n) => n === 0)) return 'inconclusive';
  if (counts.different > 0 || counts.outcome_mismatch > 0) return 'regressions';
  if (counts.both_failed > 0 || counts.not_comparable > 0) return 'inconclusive';
  if (counts.equivalent > 0) return 'parity_with_accepted';
  return 'parity';
}
