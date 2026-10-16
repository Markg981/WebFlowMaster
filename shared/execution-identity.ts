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
 * - indeterminate: the worker running it was lost, or could not confirm in time that it still
 *   owned the work. Terminal: whatever it did to the application may have happened, and its
 *   result is not known (lot P11).
 */
export const EXECUTION_UNIT_STATES = [
  'planned',
  'running',
  'recorded',
  'not_startable',
  'indeterminate',
] as const;
export type ExecutionUnitState = (typeof EXECUTION_UNIT_STATES)[number];

/** A try in progress, closed with its outcome, or left by an owner whose claim ended. */
export const ATTEMPT_STATES = ['running', 'finished', 'abandoned'] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * A shared run's work item (server/runtime/run-shards.ts): waiting, held under a lease, done with
 * its results, or `indeterminate` — its lease ended with work begun and nobody may run it again.
 */
export const WORK_ITEM_STATES = ['pending', 'claimed', 'done', 'indeterminate'] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

/**
 * One claim on a work item: who holds it, and under which epoch. The epoch is raised by every
 * claim, so a worker whose claim was taken over can be told from the one that took it; it is not
 * an attempt number. `WorkClaimRef { workItemKey, owner, epoch }` of the consolidation plan.
 */
export interface WorkClaimRef {
  executionId: string;
  workItemKey: string;
  owner: string;
  epoch: number;
}

/**
 * What happens to the work of a lost worker. 'indeterminate' (the default) ends it without a
 * result. 'replay' lets another worker run it again, only for an item of one unit whose test may be
 * run twice against the application: a plan opts in, and nothing infers it from reRunOnFailure.
 */
export const WORKER_LOSS_POLICIES = ['indeterminate', 'replay'] as const;
export type WorkerLossPolicy = (typeof WORKER_LOSS_POLICIES)[number];

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

/** The directory of one dataset row below its attempt's: `row_<index>`, the index from 0. */
export const datasetRowSegment = (index: number): string => `row_${index}`;

/** How one dataset row of an attempt ended. */
export type EvidenceRowStatus = 'passed' | 'failed' | 'error' | 'skipped';

/**
 * What one attempt left behind, as persisted on its row of `execution_unit_attempts` (migration
 * 0092) before the unit's final result is written: stored paths, never file contents.
 */
export interface AttemptEvidenceRecord {
  screenshotUrl?: string | null;
  videoUrl?: string | null;
  traceUrl?: string | null;
  harUrl?: string | null;
  /** One entry per UI dataset row the attempt ran, in row order. Absent for a test without rows. */
  rows?: Array<{
    datasetRow: number;
    status: EvidenceRowStatus;
    error?: string | null;
    screenshotUrl?: string | null;
    videoUrl?: string | null;
    traceUrl?: string | null;
    harUrl?: string | null;
  }>;
}

/**
 * Links to one slice of evidence as the report and the API hand them out: only to files the caller
 * may open, and `restricted` when raw evidence was kept that they may not.
 */
export interface EvidenceLinks {
  screenshotUrl: string | null;
  videoUrl: string | null;
  traceUrl: string | null;
  harUrl: string | null;
  restricted: boolean;
}

export interface AttemptRowView extends EvidenceLinks {
  datasetRow: number;
  status: EvidenceRowStatus;
  error: string | null;
}

export interface AttemptView extends EvidenceLinks {
  attempt: number;
  state: AttemptState;
  status: string | null;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  rows: AttemptRowView[];
}

/** One unit's attempts, for the drill-down from a report row (UI) or the API. */
export interface UnitEvidenceView {
  unitId: string;
  /** The attempt the unit's result stands on, or null when nothing was tried. */
  decidingAttempt: number | null;
  attempts: AttemptView[];
}
