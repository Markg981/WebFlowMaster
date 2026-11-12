import type { CheckpointCapture, ComparisonDifference, ComparisonPolicy } from '@shared/comparison';
import { textsMatch } from './normalizers';
import { diffCheckpoints, type DifferenceAt } from './checkpoints';
import type { ComparedStep } from './steps';

function textsOf(capture: CheckpointCapture): string[] {
  const texts = (capture.data as { texts?: unknown } | null)?.texts;
  return Array.isArray(texts) ? texts.map((t) => String(t)) : [];
}

/** Text checkpoints with the same name, compared text by text under the policy. */
export function diffText(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  return diffCheckpoints(
    baseline,
    candidate,
    'text',
    (a, b) => {
      const x = textsOf(a);
      const y = textsOf(b);
      const out: DifferenceAt[] = [];
      if (x.length !== y.length)
        out.push({ path: 'texts.length', baseline: x.length, candidate: y.length });
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        if (i < x.length && i < y.length && textsMatch(x[i], y[i], policy)) continue;
        out.push({ path: `texts[${i}]`, baseline: x[i] ?? null, candidate: y[i] ?? null });
      }
      return out;
    },
    textsOf,
  );
}
