import path from 'path';
import fs from 'fs-extra';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * Comparing what a step looks like now against what it looked like when it was accepted.
 *
 * `test_plans.visual_testing_enabled` has existed, with a switch in the plan wizard labelled
 * "Visual Testing (Experimental)", since before there was anything behind it: the column was
 * written, read by nothing, and a plan that turned it on ran exactly as a plan that left it
 * off. This is the thing it turns on.
 *
 * The unit is the step, not the test. A test that fails visually is a question — "what
 * changed?" — and a baseline per step answers it with the step number; a single baseline of
 * the final page only reports that the end state differs, which is where the investigation
 * would have started anyway.
 */

/** Fraction of the page's pixels that may differ before the step is called a failure. */
export const DEFAULT_VISUAL_THRESHOLD = 0.01;

/**
 * How different two pixels must be before pixelmatch counts them.
 *
 * Playwright's own screenshot comparison uses a comparable tolerance. Antialiasing and
 * subpixel text rendering move single channels by a few units between runs on the same
 * machine, and a zero tolerance turns every one of those into a "visual change".
 */
const PIXEL_TOLERANCE = 0.1;

export interface VisualContext {
  /** Identifies the baseline set: one per test, per browser. */
  testId: number;
  organizationId: number;
  /** The browser label the run is on — Firefox and Chromium do not render the same page alike. */
  browser: string;
  /**
   * A further split of the baseline set, used for a test that runs over a dataset.
   *
   * Row two renders row two's data, so comparing it against row one's baseline would report
   * the dataset working as a visual regression. Each row gets its own baseline instead.
   */
  variant?: string | null;
  /** Fraction of differing pixels tolerated. */
  threshold?: number;
  /**
   * Accept whatever this run produces as the new baseline.
   *
   * Without this a legitimate redesign leaves a plan permanently red with no way out but
   * deleting files off the server. This is the way out.
   */
  updateBaselines?: boolean;
  /** Where the run writes its baseline/actual/diff artefacts, so the report can show them. */
  artifactDir?: string;
}

export type VisualOutcome =
  | { kind: 'baseline-created'; baselinePath: string; detail: string }
  | { kind: 'baseline-updated'; baselinePath: string; detail: string }
  | { kind: 'match'; diffRatio: number; detail: string }
  | {
      kind: 'diff';
      diffRatio: number;
      baselinePath: string;
      /** Written into the run's directory, so the report can link all three. */
      artifacts: { baseline?: string; actual?: string; diff?: string };
      detail: string;
    }
  | { kind: 'skipped'; reason: string };

/** Where baselines live between runs. Deliberately outside `results/`, which is per-run. */
export function baselineRoot(): string {
  return process.env.VISUAL_BASELINE_DIR || path.join('./data', 'visual-baselines');
}

/** Anything that could turn a browser label or a step name into a path traversal. */
function safeSegment(value: string | number): string {
  return String(value).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60) || 'unnamed';
}

export function baselinePathFor(ctx: VisualContext, stepIndex: number): string {
  return path.join(
    baselineRoot(),
    `org_${safeSegment(ctx.organizationId)}`,
    `test_${safeSegment(ctx.testId)}`,
    safeSegment(ctx.browser),
    ...(ctx.variant ? [safeSegment(ctx.variant)] : []),
    `step_${String(stepIndex).padStart(3, '0')}.png`,
  );
}

/**
 * Compares one step's screenshot with its baseline, creating the baseline if there is none.
 *
 * A first run therefore never fails for a visual reason: there is nothing yet to be different
 * from, and failing a test because nobody had run it before would be a fact about the tool,
 * not about the application.
 */
export async function compareStepScreenshot(
  ctx: VisualContext,
  stepIndex: number,
  actual: Buffer,
): Promise<VisualOutcome> {
  const baselinePath = baselinePathFor(ctx, stepIndex);

  try {
    const exists = await fs.pathExists(baselinePath);

    if (!exists || ctx.updateBaselines) {
      await fs.ensureDir(path.dirname(baselinePath));
      await fs.writeFile(baselinePath, actual);
      return exists
        ? {
            kind: 'baseline-updated',
            baselinePath,
            detail: `Visual baseline replaced with this run's screenshot (${ctx.browser}).`,
          }
        : {
            kind: 'baseline-created',
            baselinePath,
            detail: `Visual baseline recorded for this step (${ctx.browser}); later runs are compared against it.`,
          };
    }

    const baselineBuffer = await fs.readFile(baselinePath);
    const baselinePng = PNG.sync.read(baselineBuffer);
    const actualPng = PNG.sync.read(actual);
    const threshold = ctx.threshold ?? DEFAULT_VISUAL_THRESHOLD;

    if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
      // Two images of different sizes cannot be compared pixel by pixel, and the size change
      // is itself the finding — a layout that reflowed, or a page that grew a banner.
      const artifacts = await writeArtifacts(ctx, stepIndex, baselineBuffer, actual, undefined);
      return {
        kind: 'diff',
        diffRatio: 1,
        baselinePath,
        artifacts,
        detail:
          `Visual difference: the page is a different size than the baseline ` +
          `(${baselinePng.width}×${baselinePng.height} → ${actualPng.width}×${actualPng.height}).`,
      };
    }

    const diff = new PNG({ width: baselinePng.width, height: baselinePng.height });
    const differingPixels = pixelmatch(
      baselinePng.data,
      actualPng.data,
      diff.data,
      baselinePng.width,
      baselinePng.height,
      { threshold: PIXEL_TOLERANCE },
    );
    const totalPixels = baselinePng.width * baselinePng.height;
    const diffRatio = totalPixels > 0 ? differingPixels / totalPixels : 0;

    if (diffRatio <= threshold) {
      return {
        kind: 'match',
        diffRatio,
        detail: `Visually unchanged (${formatPercent(diffRatio)} of pixels differ, tolerance ${formatPercent(threshold)}).`,
      };
    }

    const artifacts = await writeArtifacts(ctx, stepIndex, baselineBuffer, actual, PNG.sync.write(diff));
    return {
      kind: 'diff',
      diffRatio,
      baselinePath,
      artifacts,
      detail:
        `Visual difference: ${formatPercent(diffRatio)} of pixels changed ` +
        `(tolerance ${formatPercent(threshold)}, ${differingPixels} of ${totalPixels} pixels).`,
    };
  } catch (error: any) {
    // A broken PNG or an unwritable directory is a problem with the comparison, not with the
    // application under test, and must not be reported as a visual regression.
    return { kind: 'skipped', reason: `Visual comparison could not run: ${error?.message ?? error}` };
  }
}

async function writeArtifacts(
  ctx: VisualContext,
  stepIndex: number,
  baseline: Buffer,
  actual: Buffer,
  diff: Buffer | undefined,
): Promise<{ baseline?: string; actual?: string; diff?: string }> {
  if (!ctx.artifactDir) return {};
  try {
    await fs.ensureDir(ctx.artifactDir);
    const stem =
      `visual_${safeSegment(ctx.browser)}` +
      `${ctx.variant ? `_${safeSegment(ctx.variant)}` : ''}` +
      `_step_${String(stepIndex).padStart(3, '0')}`;
    const baselineOut = path.join(ctx.artifactDir, `${stem}_baseline.png`);
    const actualOut = path.join(ctx.artifactDir, `${stem}_actual.png`);
    await fs.writeFile(baselineOut, baseline);
    await fs.writeFile(actualOut, actual);
    let diffOut: string | undefined;
    if (diff) {
      diffOut = path.join(ctx.artifactDir, `${stem}_diff.png`);
      await fs.writeFile(diffOut, diff);
    }
    return { baseline: baselineOut, actual: actualOut, diff: diffOut };
  } catch {
    // The comparison stands on its own; losing the pictures must not lose the verdict.
    return {};
  }
}

function formatPercent(ratio: number): string {
  if (ratio === 0) return '0%';
  const percent = ratio * 100;
  return percent < 0.01 ? '<0.01%' : `${percent.toFixed(2)}%`;
}

/** True when a visual outcome should make the step, and so the test, fail. */
export function isVisualFailure(outcome: VisualOutcome): outcome is Extract<VisualOutcome, { kind: 'diff' }> {
  return outcome.kind === 'diff';
}
