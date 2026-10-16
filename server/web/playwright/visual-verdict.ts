import type { VisualOutcome } from '../visual-testing';
import type { StepResult } from './types';

/**
 * What a visual comparison does to a step, and what the steps do to the test (C09, P06).
 *
 * Four outcomes, kept apart: a match (or a baseline recorded or deliberately replaced) leaves the
 * step passed; a diff fails it, as a visual regression; an error — the comparison was asked for
 * and could not be made — also stops the step, but the test it belongs to ends in error rather
 * than failure, because nothing about the application was found wrong and nothing was verified
 * either. A step that is not compared on purpose (it changes nothing on screen, or it already
 * failed) has no visual outcome at all.
 */

/** The step's record of its comparison, as the report reads it. */
export function stepVisualOf(outcome: VisualOutcome): NonNullable<StepResult['visual']> {
  switch (outcome.kind) {
    case 'diff':
      return {
        outcome: 'diff',
        detail: outcome.detail,
        diffRatio: outcome.diffRatio,
        baselineImage: outcome.artifacts.baseline,
        actualImage: outcome.artifacts.actual,
        diffImage: outcome.artifacts.diff,
      };
    case 'match':
      return { outcome: 'match', detail: outcome.detail, diffRatio: outcome.diffRatio };
    case 'error':
      return { outcome: 'error', cause: outcome.cause, detail: outcome.detail };
    default:
      return { outcome: outcome.kind, detail: outcome.detail };
  }
}

/** True for a step stopped because its visual comparison could not be made. */
export function isVisualErrorStep(step: Pick<StepResult, 'status' | 'visual'>): boolean {
  return step.status === 'failed' && step.visual?.outcome === 'error';
}

/**
 * The test's status from the runner's answer.
 *
 * An unverified mandatory comparison is an error, never a pass and never a failure. A step of
 * the application's own that failed still makes the test failed, since that is a finding.
 */
export function sequenceStatus(result: {
  success: boolean;
  steps?: Pick<StepResult, 'status' | 'visual'>[];
}): 'passed' | 'failed' | 'error' {
  const failed = (result.steps ?? []).filter((step) => step.status === 'failed');
  if (failed.length > 0 && failed.every(isVisualErrorStep)) return 'error';
  if (!result.success || failed.length > 0) return 'failed';
  return 'passed';
}
