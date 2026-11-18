import type { ComparisonDifference } from '@shared/comparison';
import { pairSteps, type ComparedStep } from './steps';

/**
 * Steps whose outcome differs: passed on one side and failed on the other, or run on one side
 * only (a test that stopped earlier, or a step the other side never reached).
 *
 * A step that passed inside an `if` branch on one side and is absent on the other is informative:
 * the condition went the other way there (a "wait while it is still loading" guard on a slower
 * page), which is a difference in timing, not in what the page does. What the branch guards is
 * still compared by the steps after it.
 */
export function diffOutcome(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
): ComparisonDifference[] {
  const differences: ComparisonDifference[] = [];
  for (const pair of pairSteps(baseline, candidate)) {
    const left = pair.baseline?.status ?? null;
    const right = pair.candidate?.status ?? null;
    if (left === right) continue;
    const step = (pair.baseline ?? pair.candidate)!;
    const branchTakenOnOneSide =
      (pair.baseline === null || pair.candidate === null) &&
      step.status === 'passed' &&
      step.inBranch === true;
    differences.push({
      stepId: step.stepId,
      stepIndex: step.index,
      checkpoint: null,
      kind: 'outcome',
      path: 'status',
      baseline: left,
      candidate: right,
      severity: branchTakenOnOneSide ? 'informative' : 'blocking',
    });
  }
  return differences;
}
