import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { comparisonPolicyOf } from '@shared/comparison';
import { diffVisual, type ScreenshotLoader } from './diff-visual';
import { stepsOfLog } from './steps';

function png(width: number, height: number, dark = 0): Buffer {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const value = i < dark ? 0 : 255;
    image.data.set([value, value, value, 255], i * 4);
  }
  return PNG.sync.write(image);
}

const step = (screenshot: string, status: 'passed' | 'failed' = 'passed') =>
  stepsOfLog(JSON.stringify([{ stepId: 's', status, screenshot }]));

const images: Record<string, Buffer> = {
  plain: png(10, 10),
  marked: png(10, 10, 30),
  tall: png(10, 12),
};
const load: ScreenshotLoader = async (_side, stored) => images[stored] ?? null;

describe('diffVisual', () => {
  it('reports changed pixels beyond the threshold, informative by default', async () => {
    const [difference] = await diffVisual(
      step('plain'),
      step('marked'),
      comparisonPolicyOf({}),
      load,
    );
    expect(difference).toMatchObject({ kind: 'visual', path: 'pixels', severity: 'informative' });
    expect((difference.candidate as { diffRatio: number }).diffRatio).toBeCloseTo(0.3);
  });

  it('is blocking when the policy says so, and reports a change of size', async () => {
    const policy = comparisonPolicyOf({ visual: { mode: 'blocking' } });
    const [difference] = await diffVisual(step('plain'), step('tall'), policy, load);
    expect(difference).toMatchObject({ path: 'size', severity: 'blocking' });
  });

  it('compares nothing when off, for a failed step, or when an image cannot be read', async () => {
    expect(
      await diffVisual(
        step('plain'),
        step('marked'),
        comparisonPolicyOf({ visual: { mode: 'off' } }),
        load,
      ),
    ).toEqual([]);
    expect(
      await diffVisual(step('plain'), step('marked', 'failed'), comparisonPolicyOf({}), load),
    ).toEqual([]);
    expect(await diffVisual(step('plain'), step('missing'), comparisonPolicyOf({}), load)).toEqual(
      [],
    );
    const throws: ScreenshotLoader = async () => {
      throw new Error('store down');
    };
    expect(await diffVisual(step('plain'), step('marked'), comparisonPolicyOf({}), throws)).toEqual(
      [],
    );
  });
});
