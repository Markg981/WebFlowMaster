import type { CheckpointCapture, CheckpointKind, ComparisonDifference } from '@shared/comparison';
import type { ComparedStep } from './steps';

interface Located {
  step: ComparedStep;
  capture: CheckpointCapture;
}

/** A difference inside one checkpoint: where, and the two sides' values there. */
export interface DifferenceAt {
  path: string;
  baseline: unknown;
  candidate: unknown;
}

/** Checkpoints of one kind by name; a name used twice keeps the first, as the author meant one. */
function checkpointsOf(steps: ComparedStep[], kind: CheckpointKind): Map<string, Located> {
  const out = new Map<string, Located>();
  for (const step of steps) {
    const capture = step.checkpoint;
    if (capture?.kind === kind && !out.has(capture.name)) out.set(capture.name, { step, capture });
  }
  return out;
}

/**
 * The checkpoints of one kind with the same name on both sides, compared by `compare` unless their
 * hashes already agree. A checkpoint on one side only is itself a difference: the step that should
 * have captured it did not run, or failed. Every difference of a checkpoint is blocking.
 */
export function diffCheckpoints(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  kind: CheckpointKind,
  compare: (a: CheckpointCapture, b: CheckpointCapture) => DifferenceAt[],
  /** What a one-sided checkpoint shows of itself; its data by default. */
  valueOf: (capture: CheckpointCapture) => unknown = (capture) => capture.data,
): ComparisonDifference[] {
  const left = checkpointsOf(baseline, kind);
  const right = checkpointsOf(candidate, kind);
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
      kind,
      severity: 'blocking' as const,
    };
    if (!a || !b) {
      differences.push({
        ...base,
        path: '',
        baseline: a ? valueOf(a.capture) : null,
        candidate: b ? valueOf(b.capture) : null,
      });
      continue;
    }
    if (a.capture.hash === b.capture.hash) continue;
    for (const at of compare(a.capture, b.capture)) differences.push({ ...base, ...at });
  }
  return differences;
}

/**
 * Items by a key, a repeated key numbered from its second occurrence (`Sales`, `Sales#2`): two
 * series of the same name pair in the order they come.
 */
export function keyed<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(n === 1 ? key : `${key}#${n}`, item);
  }
  return out;
}

/** The keys of both maps, the first's order then the second's extra ones. */
export function unionKeys(a: Map<string, unknown>, b: Map<string, unknown>): string[] {
  return [...a.keys(), ...[...b.keys()].filter((key) => !a.has(key))];
}
