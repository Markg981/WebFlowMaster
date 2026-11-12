import { stepListOf } from '@shared/mobile';
import type { CheckpointCapture } from '@shared/comparison';

/** One step of a stored result, as the comparison reads it. */
export interface ComparedStep {
  /** What pairs it with the other side's step: its id (or position) and which occurrence of it. */
  key: string;
  index: number;
  stepId: string | null;
  name: string;
  status: 'passed' | 'failed';
  screenshot: string | null;
  checkpoint: CheckpointCapture | null;
  /** How long the step took, when the log says (a mobile step does, a web step does not yet). */
  durationMs?: number | null;
}

function isCheckpoint(value: unknown): value is CheckpointCapture {
  const c = value as CheckpointCapture | null;
  return !!c && typeof c === 'object' && typeof c.name === 'string' && typeof c.kind === 'string';
}

/**
 * The steps of a result's detailed_log, with the reader the report uses (`stepListOf`).
 *
 * A step is keyed by its own id when it has one, its position otherwise, plus how many times that
 * key came before: a step group called twice repeats its ids, and the second call pairs with the
 * second call.
 */
export function stepsOfLog(detailedLog: string | null | undefined): ComparedStep[] {
  if (!detailedLog) return [];
  let parsed: unknown;
  try {
    parsed = stepListOf(JSON.parse(detailedLog));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Map<string, number>();
  const steps: ComparedStep[] = [];
  parsed.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const step = raw as Record<string, unknown>;
    const stepId = typeof step.stepId === 'string' && step.stepId ? step.stepId : null;
    const calledFrom = typeof step.calledFrom === 'string' ? step.calledFrom : '';
    const base = stepId ? `${calledFrom}/${stepId}` : `#${index}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    steps.push({
      key: `${base}@${occurrence}`,
      index,
      stepId,
      name: String(step.name ?? 'Unnamed step'),
      status: step.status === 'failed' ? 'failed' : 'passed',
      screenshot: typeof step.screenshot === 'string' && step.screenshot ? step.screenshot : null,
      checkpoint: isCheckpoint(step.checkpoint) ? step.checkpoint : null,
      durationMs:
        typeof step.durationMs === 'number' && Number.isFinite(step.durationMs)
          ? step.durationMs
          : null,
    });
  });
  return steps;
}

/** The two sides' steps paired by key, in baseline order then the candidate's extra ones. */
export function pairSteps(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
): Array<{ baseline: ComparedStep | null; candidate: ComparedStep | null }> {
  const byKey = new Map(candidate.map((step) => [step.key, step]));
  const pairs: Array<{ baseline: ComparedStep | null; candidate: ComparedStep | null }> =
    baseline.map((step) => ({ baseline: step, candidate: byKey.get(step.key) ?? null }));
  const paired = new Set(baseline.map((step) => step.key));
  for (const step of candidate)
    if (!paired.has(step.key)) pairs.push({ baseline: null, candidate: step });
  return pairs;
}
