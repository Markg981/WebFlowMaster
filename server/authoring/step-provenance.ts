import { createHash } from 'node:crypto';

/**
 * Where an executed step is written down (C05).
 *
 * The runner walks the sequence after expansion: a call to a two-step group has become two steps,
 * so the click written third in the test is the runner's fourth. Healing used to take the runner's
 * position and write it into the test's saved sequence, which repaired the wrong step — the
 * independent click after a group took the group's selector. Every step that leaves expansion
 * carries this instead: the sequence it is written in, its position there, and a fingerprint of
 * the step as written, so a repair goes back to that step or nowhere.
 *
 * Kept on the step itself under `provenance`, so it survives every pass that copies a step with a
 * spread (custom actions, repository elements). Nothing persists the expanded sequence, so the key
 * never reaches a saved test, a version or a bundle.
 */

/** The key a prepared step carries its provenance under. */
export const PROVENANCE_KEY = 'provenance';

export interface StepProvenance {
  /** The test's own sequence, or a step group's. */
  source: 'test' | 'group';
  /** The group that holds the step, when `source` is 'group'. */
  groupId: string | null;
  /** Position in that sequence as written, before any expansion. */
  index: number;
  /** The step's own id there, when it has one. */
  stepId: string | null;
  /** The group calls that led here, outermost first: empty for a step of the test itself. */
  callPath: Array<{ index: number; stepId: string | null }>;
  /** The selector written in the step, before a repository element replaced it. */
  selector: string | null;
  /** sha256 of the step as written: the source must still say exactly this to be repaired. */
  fingerprint: string;
  /**
   * The shared element the step names. `fingerprint` is the element as the run resolved it, or
   * null when it was not available (deleted, another project's): such a step ran on its own copy.
   */
  element?: { id: string; fingerprint: string | null };
}

type Step = { [key: string]: unknown };

/** A value with its object keys sorted and undefined entries dropped, so it hashes the same after a round trip. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

const sha256 = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)) ?? 'null')
    .digest('hex');

/** The step as written, without the provenance the runner adds to it. */
export function stepFingerprint(step: Step | null | undefined): string {
  if (!step) return sha256(null);
  const { [PROVENANCE_KEY]: _provenance, ...written } = step;
  return sha256(written);
}

/** What a repository element contributes to a run: where it is. */
export function elementFingerprint(element: {
  selector: string;
  frameSelector?: string | null;
}): string {
  return sha256({ selector: element.selector, frameSelector: element.frameSelector ?? null });
}

const stepIdOf = (step: Step): string | null => (typeof step.id === 'string' ? step.id : null);

/** The selector a step carries in its own target, if any. */
export function writtenSelector(step: Step | null | undefined): string | null {
  const target = step?.targetElement as { selector?: unknown } | null | undefined;
  return typeof target?.selector === 'string' ? target.selector : null;
}

/** The provenance a prepared step carries, or null for one that never went through preparation. */
export function provenanceOf(step: Step | null | undefined): StepProvenance | null {
  const value = step?.[PROVENANCE_KEY] as StepProvenance | undefined;
  return value && typeof value === 'object' && typeof value.fingerprint === 'string' ? value : null;
}

/** Each step of a test's own sequence, marked as written at its position there. */
export function withTestProvenance<T extends Step>(steps: T[]): T[] {
  return steps.map((step, index) =>
    provenanceOf(step)
      ? step
      : {
          ...step,
          [PROVENANCE_KEY]: {
            source: 'test',
            groupId: null,
            index,
            stepId: stepIdOf(step),
            callPath: [],
            selector: writtenSelector(step),
            fingerprint: stepFingerprint(step),
          } satisfies StepProvenance,
        },
  );
}

/** A group's step, reached through the call at `call` (the call step itself, and its position). */
export function groupStepProvenance(
  groupId: string,
  index: number,
  step: Step,
  call: { step: Step; index: number },
): StepProvenance {
  const caller = provenanceOf(call.step);
  return {
    source: 'group',
    groupId,
    index,
    stepId: stepIdOf(step),
    callPath: [
      ...(caller?.callPath ?? []),
      { index: caller?.index ?? call.index, stepId: stepIdOf(call.step) },
    ],
    selector: writtenSelector(step),
    fingerprint: stepFingerprint(step),
  };
}

/** The same step with the shared element it names, as the run resolved it (or did not). */
export function withElementProvenance<T extends Step>(
  step: T,
  elementId: string,
  element: { selector: string; frameSelector?: string | null } | null,
): T {
  const provenance = provenanceOf(step);
  if (!provenance) return step;
  return {
    ...step,
    [PROVENANCE_KEY]: {
      ...provenance,
      element: { id: elementId, fingerprint: element ? elementFingerprint(element) : null },
    },
  };
}
