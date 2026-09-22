import { asSteps, type SequenceStep } from './step-groups';

/**
 * What a test used to be.
 *
 * Saving overwrote it, and that was the whole history. The builder's save even turns a name
 * collision into an overwrite of the existing test, which is the right thing to do while
 * re-recording a flow and the wrong thing to be unable to undo: the previous walk through the
 * application was simply gone.
 *
 * It matters most exactly when it hurts most. A test that passed last week and fails today
 * poses one question first — did the application change, or did the test? — and without a
 * history nobody can answer it, so the failure gets argued about instead of investigated.
 *
 * This module is the part of that with no database in it: what a snapshot is, and what changed
 * between two of them. The summary is worked out once, when the version is written, and stored;
 * listing a history then costs no jsonb at all.
 */

export interface TestSnapshot {
  name: string;
  url: string;
  sequence: unknown;
  elements: unknown;
  preconditions?: unknown;
  dataset?: unknown;
}

/**
 * What identifies a step for the purpose of "is this the same step?".
 *
 * Not its id. A re-recorded flow produces entirely new ids for what a person would call the
 * same twelve steps, and a history that says "12 steps removed, 12 added" every time somebody
 * re-records is a history nobody reads. What a step does — the action, the thing it acts on,
 * the value it uses — is what a reader means by the same step.
 */
export function signatureOf(step: SequenceStep): string {
  const action = step.action?.id ?? 'unknown';
  const target = step.targetElement as { elementId?: string | null; selector?: string } | null | undefined;
  // The repository id first: a step that resolves through the repository is the same step even
  // after healing moves the selector underneath it.
  const on = target?.elementId ?? target?.selector ?? '';
  const value = typeof step.value === 'string' ? step.value : step.value == null ? '' : String(step.value);
  return `${action}|${on}|${value}`;
}

function countBySignature(steps: SequenceStep[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const step of steps) {
    const key = signatureOf(step);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** How many rows a dataset holds, tolerating the shapes a jsonb column can come back as. */
function rowCount(dataset: unknown): number {
  if (Array.isArray(dataset)) return dataset.length;
  if (typeof dataset === 'string') {
    try {
      const parsed = JSON.parse(dataset);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * What changed between two versions, in a sentence.
 *
 * Deliberately about steps rather than about bytes: "3 steps added, 1 removed" is what somebody
 * scanning a history is deciding between versions on. An empty string means nothing changed —
 * the caller uses that to avoid manufacturing a version for a save that saved nothing.
 */
export function describeChange(previous: TestSnapshot | null, next: TestSnapshot): string {
  const nextSteps = asSteps(next.sequence);
  if (!previous) {
    return nextSteps.length === 1 ? 'Created with 1 step.' : `Created with ${nextSteps.length} steps.`;
  }

  const previousSteps = asSteps(previous.sequence);
  const before = countBySignature(previousSteps);
  const after = countBySignature(nextSteps);

  let added = 0;
  let removed = 0;
  for (const [signature, count] of after) added += Math.max(0, count - (before.get(signature) ?? 0));
  for (const [signature, count] of before) removed += Math.max(0, count - (after.get(signature) ?? 0));

  const parts: string[] = [];
  if (added > 0) parts.push(`${added} step${added === 1 ? '' : 's'} added`);
  if (removed > 0) parts.push(`${removed} step${removed === 1 ? '' : 's'} removed`);
  if (added === 0 && removed === 0 && !sameOrder(previousSteps, nextSteps)) {
    // Same steps, different order — which changes what the test does, and would otherwise be
    // the one edit a step-counting summary reported as no change at all.
    parts.push('steps reordered');
  }

  if (previous.name !== next.name) parts.push(`renamed from "${previous.name}"`);
  if (previous.url !== next.url) parts.push('starting URL changed');

  const previousRows = rowCount(previous.dataset);
  const nextRows = rowCount(next.dataset);
  if (previousRows !== nextRows) parts.push(`dataset ${previousRows} → ${nextRows} rows`);

  const previousPre = asSteps(previous.preconditions).length;
  const nextPre = asSteps(next.preconditions).length;
  if (previousPre !== nextPre) parts.push(`preconditions ${previousPre} → ${nextPre}`);

  if (parts.length === 0) return '';
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function sameOrder(previous: SequenceStep[], next: SequenceStep[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((step, index) => signatureOf(step) === signatureOf(next[index]));
}

/** The part of a test a version keeps, and nothing else. */
export function snapshotOf(test: {
  name: string;
  url: string;
  sequence: unknown;
  elements: unknown;
  preconditions?: unknown;
  dataset?: unknown;
}): TestSnapshot {
  return {
    name: test.name,
    url: test.url,
    sequence: test.sequence,
    elements: test.elements,
    preconditions: test.preconditions ?? null,
    dataset: test.dataset ?? null,
  };
}

/** How many steps a version holds, for a list that should not have to load the sequence. */
export function stepCountOf(sequence: unknown): number {
  return asSteps(sequence).length;
}
