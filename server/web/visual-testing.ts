import path from 'path';
import fs from 'fs-extra';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { artifactStore, baselineRoot, BASELINES_PREFIX } from '../tenancy/artifact-store';

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

/** WFM_VISUAL_THRESHOLD (a fraction between 0 and 1) overrides the default for the whole process. */
export function visualThresholdFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.WFM_VISUAL_THRESHOLD);
  return env.WFM_VISUAL_THRESHOLD && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : DEFAULT_VISUAL_THRESHOLD;
}

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
  | {
      /**
       * The comparison was asked for and could not be made: the step is neither a match nor a
       * regression, and nobody verified what it looks like (C09). The cause says which part broke.
       */
      kind: 'error';
      cause: VisualErrorCause;
      detail: string;
    };

/**
 * Why a comparison that was asked for did not happen.
 *
 * - `baseline-corrupt`: the stored baseline is not a readable image. It is not replaced on its
 *   own: only a run that accepts new baselines deliberately does that.
 * - `storage-unavailable`: the artifact store could not read or write the baseline.
 * - `screenshot-unavailable`: this run's picture could not be taken or is not a readable image.
 * - `comparison-failed`: anything else that broke while comparing the two.
 */
export type VisualErrorCause =
  'baseline-corrupt' | 'storage-unavailable' | 'screenshot-unavailable' | 'comparison-failed';

/** Thrown inside the comparison to carry its cause out to the one place that reports it. */
class VisualComparisonError extends Error {
  constructor(
    readonly visualCause: VisualErrorCause,
    error: unknown,
  ) {
    super(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The outcome of a comparison that could not be made.
 *
 * Its words are deliberately not "visual difference": a report or an Allure category that groups
 * regressions by that phrase must not count an infrastructure problem among them.
 */
export function visualError(cause: VisualErrorCause, error: unknown): VisualOutcome {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return {
    kind: 'error',
    cause,
    detail: `Visual comparison could not run (${cause}): ${message}. The step was not verified visually.`,
  };
}

export { baselineRoot };

/** The part of a Playwright page a stable screenshot needs, so tests can stand in for it. */
export interface ScreenshotPage {
  waitForLoadState(state: 'load' | 'networkidle', options?: { timeout?: number }): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  screenshot(options: {
    type: 'png';
    animations?: 'disabled' | 'allow';
    caret?: 'hide' | 'initial';
  }): Promise<Buffer>;
}

/**
 * A screenshot of the page once it has stopped changing.
 *
 * The comparison took whatever the page looked like the instant a step returned. Right after a
 * navigation that is a page still loading its images and web fonts, so the baseline one run
 * recorded and the screenshot the next run took were two different moments of the same load:
 * a run that had just accepted new baselines was followed by a normal run reporting a visual
 * difference nobody had made. This waits for the load to settle, freezes animations and the
 * caret, and takes screenshots until two in a row are identical — what Playwright's own
 * `toHaveScreenshot` does — giving up after a few tries with the last one.
 */
export async function stableScreenshot(page: ScreenshotPage, maxAttempts = 5): Promise<Buffer> {
  // Each wait is best effort: a page that never goes network-idle (polling, websockets) is still
  // compared, just without that wait.
  const settle = async (wait: () => Promise<unknown>) => {
    try {
      await wait();
    } catch {
      // Proceed with what the page looks like.
    }
  };
  await settle(() => page.waitForLoadState('load', { timeout: 10_000 }));
  await settle(() => page.waitForLoadState('networkidle', { timeout: 5_000 }));
  await settle(() =>
    page.evaluate(() =>
      typeof document !== 'undefined' && (document as any).fonts
        ? (document as any).fonts.ready.then(() => true)
        : true,
    ),
  );

  const take = () => page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
  let previous = await take();
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    const current = await take();
    if (Buffer.from(current).equals(Buffer.from(previous))) return current;
    previous = current;
  }
  return previous;
}

/** Anything that could turn a browser label or a step name into a path traversal. */
function safeSegment(value: string | number): string {
  return (
    String(value)
      .replace(/[^a-z0-9_.-]/gi, '_')
      .slice(0, 60) || 'unnamed'
  );
}

function baselineSegments(ctx: VisualContext, stepIndex: number): string[] {
  return [
    `org_${safeSegment(ctx.organizationId)}`,
    `test_${safeSegment(ctx.testId)}`,
    safeSegment(ctx.browser),
    ...(ctx.variant ? [safeSegment(ctx.variant)] : []),
    `step_${String(stepIndex).padStart(3, '0')}.png`,
  ];
}

/** Where a baseline is on the local disk, when the local store keeps it. */
export function baselinePathFor(ctx: VisualContext, stepIndex: number): string {
  return path.join(baselineRoot(), ...baselineSegments(ctx, stepIndex));
}

/**
 * The baseline's key in the artifact store — the same file as baselinePathFor on the local
 * store, and an object every worker shares on a remote one. Baselines kept on each worker's own
 * disk meant a step compared against whichever copy that worker happened to have.
 */
export function baselineKeyFor(ctx: VisualContext, stepIndex: number): string {
  return `${BASELINES_PREFIX}${baselineSegments(ctx, stepIndex).join('/')}`;
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
  const store = artifactStore();
  const key = baselineKeyFor(ctx, stepIndex);
  const baselinePath = store.kind === 'local' ? baselinePathFor(ctx, stepIndex) : key;

  // Each stage names its own cause, so the caller can tell a broken baseline from a store that is
  // down and from a screenshot that is not an image.
  const stage = async <T>(cause: VisualErrorCause, work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw new VisualComparisonError(cause, error);
    }
  };

  try {
    const stored = await stage('storage-unavailable', () => store.read(key));
    const exists = stored !== null;

    // A missing baseline is recorded (the documented first-run rule) and a deliberate update
    // replaces it. An unreadable one is neither: it falls through and is reported below.
    if (!exists || ctx.updateBaselines) {
      // Never a picture that is not one: the next run would only find it corrupt.
      await stage('screenshot-unavailable', () => PNG.sync.read(actual));
      await stage('storage-unavailable', () => store.write(key, actual, 'image/png'));
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

    const baselineBuffer = stored;
    const baselinePng = await stage('baseline-corrupt', () => PNG.sync.read(baselineBuffer));
    const actualPng = await stage('screenshot-unavailable', () => PNG.sync.read(actual));
    const threshold = ctx.threshold ?? visualThresholdFromEnv();

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

    const artifacts = await writeArtifacts(
      ctx,
      stepIndex,
      baselineBuffer,
      actual,
      PNG.sync.write(diff),
    );
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
    // A broken PNG or an unreachable store is a problem with the comparison, not with the
    // application under test: not a visual regression, and not a match either.
    return error instanceof VisualComparisonError
      ? visualError(error.visualCause, error)
      : visualError('comparison-failed', error);
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

/** True when the comparison was asked for and not made: the test errs rather than passes. */
export function isVisualError(
  outcome: VisualOutcome,
): outcome is Extract<VisualOutcome, { kind: 'error' }> {
  return outcome.kind === 'error';
}

/** True when a visual outcome should make the step, and so the test, fail. */
export function isVisualFailure(
  outcome: VisualOutcome,
): outcome is Extract<VisualOutcome, { kind: 'diff' }> {
  return outcome.kind === 'diff';
}
