import type { CheckpointKind } from '@shared/comparison';
import { stepsOfLog, type ComparedStep } from './steps';

/** For tests: steps of a log with one checkpoint each, hashed by their JSON unless told. */
export function stepsWith(
  kind: CheckpointKind,
  ...checkpoints: Array<{ name: string; data: unknown; hash?: string; durationMs?: number }>
): ComparedStep[] {
  return stepsOfLog(
    JSON.stringify(
      checkpoints.map(({ name, data, hash, durationMs }, i) => ({
        stepId: `s${i}`,
        status: 'passed',
        ...(durationMs === undefined ? {} : { durationMs }),
        checkpoint: { name, kind, data, hash: hash ?? JSON.stringify(data) },
      })),
    ),
  );
}
