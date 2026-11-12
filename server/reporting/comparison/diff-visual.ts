import { PNG } from 'pngjs';
import type { ComparisonDifference, ComparisonPolicy } from '@shared/comparison';
import { diffPng } from '../../web/visual-testing';
import { pairSteps, type ComparedStep } from './steps';

/** Reads a stored step screenshot; null when it is gone or cannot be read. */
export type ScreenshotLoader = (
  side: 'baseline' | 'candidate',
  stored: string,
) => Promise<Buffer | null>;

async function decoded(load: ScreenshotLoader, side: 'baseline' | 'candidate', stored: string) {
  try {
    const buffer = await load(side, stored);
    return buffer ? PNG.sync.read(buffer) : null;
  } catch {
    return null;
  }
}

/**
 * The screenshots of steps that passed on both sides, compared pixel by pixel.
 *
 * A step that failed on either side is reported as an outcome difference already, and the page it
 * left says nothing about the look of the application. A screenshot that cannot be read is not a
 * difference: the comparison of that step is simply not made.
 */
export async function diffVisual(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
  load: ScreenshotLoader,
): Promise<ComparisonDifference[]> {
  if (policy.visual.mode === 'off') return [];
  const severity = policy.visual.mode === 'blocking' ? 'blocking' : 'informative';
  const differences: ComparisonDifference[] = [];
  for (const { baseline: a, candidate: b } of pairSteps(baseline, candidate)) {
    if (!a || !b || a.status !== 'passed' || b.status !== 'passed') continue;
    if (!a.screenshot || !b.screenshot) continue;
    const left = await decoded(load, 'baseline', a.screenshot);
    if (!left) continue;
    const right = await decoded(load, 'candidate', b.screenshot);
    if (!right) continue;
    const result = diffPng(left, right, { threshold: policy.visual.threshold });
    if (result.kind === 'match') continue;
    differences.push({
      stepId: a.stepId,
      stepIndex: a.index,
      checkpoint: null,
      kind: 'visual',
      path: result.kind === 'size-mismatch' ? 'size' : 'pixels',
      baseline: { screenshot: a.screenshot, width: left.width, height: left.height },
      candidate: {
        screenshot: b.screenshot,
        width: right.width,
        height: right.height,
        diffRatio: result.diffRatio,
      },
      severity,
    });
  }
  return differences;
}
