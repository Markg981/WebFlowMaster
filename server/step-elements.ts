import { eq } from 'drizzle-orm';
import { projectElements } from '@shared/schema';
import { withTenantTransaction } from './middleware/tenancy';
import { asSteps, type SequenceStep } from './step-groups';

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
export function resolveStepElements(sequence: unknown, elements: RepositoryElement[]): ResolutionResult {
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
      return step;
    }

    resolved++;
    return {
      ...step,
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
 * Resolves a sequence about to be run, loading whatever elements it names.
 *
 * Returns the sequence untouched, and without a query, when no step names one — which is every
 * test written before the repository existed.
 */
export async function resolveSequenceForRun(sequence: unknown): Promise<ResolutionResult> {
  const ids = referencedElementIds(sequence);
  if (ids.length === 0) return { steps: asSteps(sequence), unresolved: [], resolved: 0 };

  try {
    // No organization predicate: RLS supplies it, so an element belonging to another tenant is
    // simply absent and the step falls back to its own selector.
    const rows = await withTenantTransaction((tx) => tx.select().from(projectElements));
    return resolveStepElements(
      sequence,
      rows
        .filter((row) => ids.includes(row.id))
        .map((row) => ({ id: row.id, selector: row.selector, frameSelector: row.frameSelector })),
    );
  } catch {
    // The repository being unreachable must not stop a run that has selectors of its own.
    return { steps: asSteps(sequence), unresolved: ids, resolved: 0 };
  }
}

/**
 * Records a repaired selector against the repository element a step named.
 *
 * This is what the repository is for. Healing used to rewrite the selector inside one test's
 * saved sequence, so the same broken button was repaired again, separately, by every test that
 * touched it — and only ever after each of them had failed once.
 */
export async function recordHealedSelector(elementId: string, selector: string): Promise<boolean> {
  const updated = await withTenantTransaction((tx) =>
    tx
      .update(projectElements)
      .set({ selector, healedAt: new Date(), updatedAt: new Date() })
      .where(eq(projectElements.id, elementId))
      .returning(),
  );
  return updated.length > 0;
}

/** The repository element a step names, if it names one. */
export function elementIdOfStep(step: SequenceStep | null | undefined): string | null {
  const target = step?.targetElement as StepTarget | undefined | null;
  const id = target?.elementId;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}
