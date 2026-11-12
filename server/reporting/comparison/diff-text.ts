import type { CheckpointCapture, ComparisonDifference, ComparisonPolicy } from '@shared/comparison';
import { textsMatch } from './normalizers';
import type { ComparedStep } from './steps';

interface Located {
  step: ComparedStep;
  capture: CheckpointCapture;
}

/** Text checkpoints by name; a name used twice keeps the first, as the author meant one. */
function textCheckpoints(steps: ComparedStep[]): Map<string, Located> {
  const out = new Map<string, Located>();
  for (const step of steps) {
    const capture = step.checkpoint;
    if (capture?.kind === 'text' && !out.has(capture.name))
      out.set(capture.name, { step, capture });
  }
  return out;
}

function textsOf(capture: CheckpointCapture): string[] {
  const texts = (capture.data as { texts?: unknown } | null)?.texts;
  return Array.isArray(texts) ? texts.map((t) => String(t)) : [];
}

/**
 * Text checkpoints with the same name, compared text by text under the policy. A checkpoint on one
 * side only is itself a difference: the step that should have captured it did not run, or failed.
 */
export function diffText(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  const left = textCheckpoints(baseline);
  const right = textCheckpoints(candidate);
  const names = [...left.keys(), ...[...right.keys()].filter((name) => !left.has(name))];
  const differences: ComparisonDifference[] = [];

  for (const name of names) {
    const a = left.get(name);
    const b = right.get(name);
    const step = (a ?? b)!.step;
    const base = {
      stepId: step.stepId,
      stepIndex: step.index,
      checkpoint: name,
      kind: 'text' as const,
    };
    if (!a || !b) {
      differences.push({
        ...base,
        path: '',
        baseline: a ? textsOf(a.capture) : null,
        candidate: b ? textsOf(b.capture) : null,
        severity: 'blocking',
      });
      continue;
    }
    if (a.capture.hash === b.capture.hash) continue;
    const x = textsOf(a.capture);
    const y = textsOf(b.capture);
    if (x.length !== y.length)
      differences.push({
        ...base,
        path: 'texts.length',
        baseline: x.length,
        candidate: y.length,
        severity: 'blocking',
      });
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      if (i < x.length && i < y.length && textsMatch(x[i], y[i], policy)) continue;
      differences.push({
        ...base,
        path: `texts[${i}]`,
        baseline: x[i] ?? null,
        candidate: y[i] ?? null,
        severity: 'blocking',
      });
    }
  }
  return differences;
}
