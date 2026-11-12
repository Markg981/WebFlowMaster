import type { ComparisonDifference } from '@shared/comparison';
import { pairSteps, type ComparedStep } from './steps';

/**
 * Steps whose outcome differs: passed on one side and failed on the other, or run on one side
 * only (a test that stopped earlier, or a step the other side never reached).
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
    differences.push({
      stepId: step.stepId,
      stepIndex: step.index,
      checkpoint: null,
      kind: 'outcome',
      path: 'status',
      baseline: left,
      candidate: right,
      severity: 'blocking',
    });
  }
  return differences;
}
