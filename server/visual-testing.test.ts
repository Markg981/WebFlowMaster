import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { PNG } from 'pngjs';
import { baselinePathFor, compareStepScreenshot, isVisualFailure, type VisualContext } from './visual-testing';

/**
 * `visual_testing_enabled` was a column and a switch in the wizard with nothing behind it.
 * These are the rules of the thing now behind it.
 */

const workDir = path.join(os.tmpdir(), `visual-testing-test-${process.pid}`);
const baselineDir = path.join(workDir, 'baselines');
const artifactDir = path.join(workDir, 'run');

process.env.VISUAL_BASELINE_DIR = baselineDir;

function png(width: number, height: number, colour: [number, number, number], mark?: { x: number; y: number; w: number; h: number }): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inMark = mark && x >= mark.x && x < mark.x + mark.w && y >= mark.y && y < mark.y + mark.h;
      const idx = (width * y + x) << 2;
      image.data[idx] = inMark ? 0 : colour[0];
      image.data[idx + 1] = inMark ? 0 : colour[1];
      image.data[idx + 2] = inMark ? 0 : colour[2];
      image.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const ctx = (overrides: Partial<VisualContext> = {}): VisualContext => ({
  testId: 7,
  organizationId: 1,
  browser: 'chromium',
  artifactDir,
  ...overrides,
});

beforeEach(async () => {
  await fs.remove(workDir);
});

afterAll(async () => {
  await fs.remove(workDir);
});

describe('compareStepScreenshot', () => {
  it('records a baseline on the first run instead of failing a step nobody could have approved yet', async () => {
    const outcome = await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255]));

    expect(outcome.kind).toBe('baseline-created');
    expect(isVisualFailure(outcome)).toBe(false);
    expect(await fs.pathExists(baselinePathFor(ctx(), 0))).toBe(true);
  });

  it('passes when the page is unchanged', async () => {
    const shot = png(20, 20, [255, 255, 255]);
    await compareStepScreenshot(ctx(), 0, shot);

    const outcome = await compareStepScreenshot(ctx(), 0, shot);

    expect(outcome.kind).toBe('match');
    expect(isVisualFailure(outcome)).toBe(false);
  });

  it('fails the step when enough pixels changed, and keeps the three pictures for the report', async () => {
    await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255]));

    const outcome = await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255], { x: 0, y: 0, w: 10, h: 10 }));

    expect(outcome.kind).toBe('diff');
    if (outcome.kind !== 'diff') throw new Error('expected a diff');
    expect(outcome.diffRatio).toBeCloseTo(0.25, 2);
    expect(await fs.pathExists(outcome.artifacts.baseline!)).toBe(true);
    expect(await fs.pathExists(outcome.artifacts.actual!)).toBe(true);
    expect(await fs.pathExists(outcome.artifacts.diff!)).toBe(true);
  });

  it('tolerates a change below the threshold, so antialiasing is not a regression', async () => {
    await compareStepScreenshot(ctx(), 0, png(100, 100, [255, 255, 255]));

    // 25 pixels of 10,000 — a quarter of a percent, under the 1% default.
    const outcome = await compareStepScreenshot(ctx(), 0, png(100, 100, [255, 255, 255], { x: 0, y: 0, w: 5, h: 5 }));

    expect(outcome.kind).toBe('match');
  });

  it('treats a page that changed size as a difference, since it cannot be compared pixel by pixel', async () => {
    await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255]));

    const outcome = await compareStepScreenshot(ctx(), 0, png(20, 40, [255, 255, 255]));

    expect(outcome.kind).toBe('diff');
    if (outcome.kind !== 'diff') throw new Error('expected a diff');
    expect(outcome.detail).toContain('different size');
  });

  it('keeps a separate baseline per browser, because two engines do not render one page alike', async () => {
    await compareStepScreenshot(ctx({ browser: 'chromium' }), 0, png(20, 20, [255, 255, 255]));

    const onFirefox = await compareStepScreenshot(ctx({ browser: 'firefox' }), 0, png(20, 20, [0, 0, 0]));

    expect(onFirefox.kind).toBe('baseline-created');
  });

  it("keeps a separate baseline per dataset row, so the dataset working is not a regression", async () => {
    await compareStepScreenshot(ctx({ variant: 'row_1' }), 0, png(20, 20, [255, 255, 255]));

    const secondRow = await compareStepScreenshot(ctx({ variant: 'row_2' }), 0, png(20, 20, [0, 0, 0]));

    expect(secondRow.kind).toBe('baseline-created');
  });

  it('keeps a separate baseline per step', async () => {
    await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255]));

    const secondStep = await compareStepScreenshot(ctx(), 1, png(20, 20, [0, 0, 0]));

    expect(secondStep.kind).toBe('baseline-created');
  });

  it('replaces the baseline on request, which is how a legitimate redesign gets out of red', async () => {
    await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255]));
    const redesigned = png(20, 20, [0, 0, 0]);

    const updated = await compareStepScreenshot(ctx({ updateBaselines: true }), 0, redesigned);
    const afterwards = await compareStepScreenshot(ctx(), 0, redesigned);

    expect(updated.kind).toBe('baseline-updated');
    expect(afterwards.kind).toBe('match');
  });

  it('reports a broken image as a comparison that could not run, not as a visual regression', async () => {
    const target = baselinePathFor(ctx(), 0);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, Buffer.from('this is not a png'));

    const outcome = await compareStepScreenshot(ctx(), 0, png(20, 20, [255, 255, 255]));

    expect(outcome.kind).toBe('skipped');
    expect(isVisualFailure(outcome)).toBe(false);
  });

  it('does not let a browser label escape the baseline directory', async () => {
    const outcome = await compareStepScreenshot(ctx({ browser: '../../etc' }), 0, png(20, 20, [255, 255, 255]));

    expect(outcome.kind).toBe('baseline-created');
    if (outcome.kind !== 'baseline-created') throw new Error('expected a baseline');
    expect(path.resolve(outcome.baselinePath).startsWith(path.resolve(baselineDir))).toBe(true);
  });
});
