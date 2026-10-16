/**
 * Who a result belongs to: the identity of a run's units and of each attempt at one.
 *
 * A run used to know its results only by what they said about themselves — a test name, a browser
 * label, how many rows there were. Two occurrences of the same test, the same test in two
 * languages, or two rows of one BDD dataset could not be told apart, and "every test has a result"
 * was a count. A unit is now named once, in the run's manifest (migration 0091), before anything
 * runs, and every result and attempt points at it.
 *
 *   ExecutionUnitRef   { executionId, unitId }            — one expected unit of one run
 *   ExecutionAttemptRef  ExecutionUnitRef + { attempt }    — one try at it (1, 2, … per re-run)
 *   EvidenceSliceRef     ExecutionAttemptRef + { datasetRow } — one UI dataset row inside a try
 *
 * The unit id is opaque and scoped to its run: it is not a fingerprint to compare across runs, and
 * it carries no dataset value, secret, URL or name — only the coordinates below, hashed.
 */

export interface ExecutionUnitRef {
  executionId: string;
  unitId: string;
}

export interface ExecutionAttemptRef extends ExecutionUnitRef {
  /** 1 for the first try, then one more per re-run. Monotonic; not a lease epoch. */
  attempt: number;
}

export interface EvidenceSliceRef extends ExecutionAttemptRef {
  /** A UI dataset row run inside the attempt, or null for the attempt as a whole. */
  datasetRow: number | null;
}

/**
 * The browser a unit was asked to run on, as the plan named it: the identity is the request, not
 * what the probe fell back to (a headed browser run headless, a channel run on its engine).
 */
export interface UnitBrowser {
  name: string;
  channel: string | null;
  device: string | null;
  os: string | null;
  osVersion: string | null;
  browserVersion: string | null;
}

/** Where in the plan, and on what, one unit runs. Nothing here is a dataset value or a secret. */
export interface UnitCoordinates {
  testType: 'ui' | 'api' | 'mobile';
  /** The test's id, or null for a link to a test that no longer exists. */
  testId: number | null;
  /** Which occurrence of this test in the plan: 0 for the first, 1 when it appears again… */
  occurrence: number;
  browser: UnitBrowser | null;
  locale: string | null;
  /** A mobile test's device target (`device-N`), or null. */
  device: string | null;
  /** A cucumber test's dataset row, by index; never its values. */
  bddRow: number | null;
  /** Set only when two units would otherwise be identical, so none collides. */
  duplicate?: number;
}

/**
 * What a planned unit is waiting for.
 *
 * - planned: written to the manifest; nothing has tried it yet.
 * - running: an attempt has been assigned.
 * - recorded: its single final result row exists.
 * - not_startable: the plan asked for it, and its browser would not start here. Expected all the
 *   same: a browser that does not start is a gap, not a smaller plan.
 */
export const EXECUTION_UNIT_STATES = ['planned', 'running', 'recorded', 'not_startable'] as const;
export type ExecutionUnitState = (typeof EXECUTION_UNIT_STATES)[number];

/** Keys sorted, so the same coordinates always serialize the same way. */
export function canonicalCoordinates(coordinates: UnitCoordinates): string {
  return JSON.stringify(sortKeys(coordinates));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}

/** A unit id as the manifest writes it: `u_` and 24 hex characters. */
export const UNIT_ID_PATTERN = /^u_[0-9a-f]{24}$/;

export const isUnitId = (value: unknown): value is string =>
  typeof value === 'string' && UNIT_ID_PATTERN.test(value);

/**
 * The storage prefix of one attempt's evidence: opaque ids and numbers only, so a path never
 * carries a dataset value or a secret. `results/<plan>/<run>/units/<unit>/attempt_<n>[/row_<m>]`.
 */
export function evidenceKey(planId: string, slice: EvidenceSliceRef): string {
  if (!isUnitId(slice.unitId)) throw new Error('Not a unit id.');
  if (!Number.isInteger(slice.attempt) || slice.attempt < 1) throw new Error('Not an attempt.');
  const { datasetRow } = slice;
  if (datasetRow !== null && !(Number.isInteger(datasetRow) && datasetRow >= 0))
    throw new Error('Not a dataset row.');
  const row = datasetRow === null ? '' : `/row_${datasetRow}`;
  return `results/${planId}/${slice.executionId}/units/${slice.unitId}/attempt_${slice.attempt}${row}`;
}
