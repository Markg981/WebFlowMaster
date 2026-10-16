import { eq, inArray } from 'drizzle-orm';
import { projectElements } from '@shared/schema';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
import { asSteps, type SequenceStep } from './step-groups';
import { elementFingerprint, withElementProvenance } from './step-provenance';

/**
 * Letting a step name an element from the project's repository instead of carrying its own copy.
 *
 * `detected_elements` belongs to one test, so the same button is written down once per test
 * that touches it. When the application moves that button, every copy is wrong separately —
 * and the healing pass repairs the copy inside whichever test happened to run, leaving the
 * others to fail one at a time, each looking like a new problem.
 *
 * Additive on purpose. A step that names a repository element resolves through it; a step that
 * does not keeps the selector it has always had and behaves exactly as before. No existing
 * test was rewritten to make this work, which is why turning it on costs nothing.
 */

/** What a step's target looks like once it may point at the repository. */
export interface StepTarget {
  selector?: string;
  frameSelector?: string | null;
  /** Set when this step resolves through the project's element repository. */
  elementId?: string | null;
  [key: string]: unknown;
}

export interface ResolutionResult {
  steps: SequenceStep[];
  /**
   * Elements a step named and the repository no longer holds.
   *
   * Not an error: the step keeps the selector it was saved with, which is what it would have
   * used before the repository existed. Reported so the run's console can say that a test is
   * running on a stale copy rather than on the shared definition it asked for.
   */
  unresolved: string[];
  resolved: number;
}

export interface RepositoryElement {
  id: string;
  selector: string;
  frameSelector?: string | null;
}

/** The repository elements a sequence names, once each. */
export function referencedElementIds(sequence: unknown): string[] {
  const ids: string[] = [];
  for (const step of asSteps(sequence)) {
    const target = step.targetElement as StepTarget | undefined | null;
    const id = target?.elementId;
    if (typeof id === 'string' && id.trim() !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Replaces each named element's selector with the repository's current one.
 *
 * The step keeps everything else it carries — its text, its tag, whatever the builder shows —
 * because what the repository owns is where the element is, not what it looked like when
 * somebody last recorded it.
 */
export function resolveStepElements(
  sequence: unknown,
  elements: RepositoryElement[],
): ResolutionResult {
  const steps = asSteps(sequence);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const unresolved: string[] = [];
  let resolved = 0;

  const out = steps.map((step) => {
    const target = step.targetElement as StepTarget | undefined | null;
    const id = target?.elementId;
    if (!target || typeof id !== 'string' || id.trim() === '') return step;

    const element = byId.get(id);
    if (!element) {
      if (!unresolved.includes(id)) unresolved.push(id);
      return withElementProvenance(step, id, null);
    }

    resolved++;
    return {
      ...withElementProvenance(step, id, element),
      targetElement: {
        ...target,
        selector: element.selector,
        frameSelector: element.frameSelector ?? target.frameSelector ?? null,
      },
    };
  });

  return { steps: out, unresolved, resolved };
}

/**
 * These repository elements, read in the caller's transaction.
 *
 * No organization predicate: RLS supplies it, so an element belonging to another tenant (or to a
 * restricted project the caller cannot see) is simply absent and the step falls back to its own
 * selector.
 */
export async function loadRepositoryElements(
  tx: TenantTx,
  ids: string[],
): Promise<Array<RepositoryElement & { name: string; projectId: number; updatedAt: Date | null }>> {
  if (ids.length === 0) return [];
  const rows = await tx.select().from(projectElements).where(inArray(projectElements.id, ids));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    selector: row.selector,
    frameSelector: row.frameSelector ?? null,
    updatedAt: row.updatedAt ?? null,
  }));
}

/**
 * Resolves a sequence about to be run, loading whatever elements it names.
 *
 * Returns the sequence untouched, and without a query, when no step names one — which is every
 * test written before the repository existed.
 */
export async function resolveSequenceForRun(sequence: unknown): Promise<ResolutionResult> {
  const ids = referencedElementIds(sequence);
  if (ids.length === 0) return { steps: asSteps(sequence), unresolved: [], resolved: 0 };

  try {
    const rows = await withTenantTransaction((tx) => loadRepositoryElements(tx, ids));
    return resolveStepElements(
      sequence,
      rows.map(({ id, selector, frameSelector }) => ({ id, selector, frameSelector })),
    );
  } catch {
    // The repository being unreachable must not stop a run that has selectors of its own.
    return { steps: asSteps(sequence), unresolved: ids, resolved: 0 };
  }
}

/** What a guarded write of a healed selector did. */
export type GuardedSelectorWrite =
  { status: 'applied' | 'already_applied' } | { status: 'conflict'; reason: 'absent' | 'changed' };

/**
 * Records a repaired selector against the repository element a step named, in the caller's
 * transaction, if the element is still what the run resolved.
 *
 * This is what the repository is for: one row, read by every test that names it. The row is
 * locked and compared with the fingerprint the run took of it; an element edited, healed or
 * deleted since is left alone and the repair is reported as a conflict (C05). RLS decides which
 * rows the transaction sees, so another tenant's element is simply absent.
 */
export async function writeHealedElementSelector(
  tx: TenantTx,
  input: { elementId: string; fingerprint: string; selector: string },
): Promise<GuardedSelectorWrite> {
  const [row] = await tx
    .select()
    .from(projectElements)
    .where(eq(projectElements.id, input.elementId))
    .for('update');
  if (!row) return { status: 'conflict', reason: 'absent' };
  const current = { selector: row.selector, frameSelector: row.frameSelector ?? null };
  if (elementFingerprint(current) !== input.fingerprint) {
    // Another run of the same repair got there first: the element already says this.
    return current.selector === input.selector
      ? { status: 'already_applied' }
      : { status: 'conflict', reason: 'changed' };
  }
  await tx
    .update(projectElements)
    .set({
      selector: input.selector,
      originalSelector: row.originalSelector ?? row.selector,
      healedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectElements.id, input.elementId));
  return { status: 'applied' };
}

/** The repository element a step names, if it names one. */
export function elementIdOfStep(step: SequenceStep | null | undefined): string | null {
  const target = step?.targetElement as StepTarget | undefined | null;
  const id = target?.elementId;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}
