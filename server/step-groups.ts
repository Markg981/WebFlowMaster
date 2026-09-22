import { STEP_GROUP_ACTION_ID } from '@shared/recording';
import { stepGroups } from '@shared/schema';
import { withTenantTransaction } from './middleware/tenancy';

/**
 * Turning "call the login group" into the six steps the login group holds.
 *
 * The expansion happens at run time rather than when the test is saved, and that is the whole
 * value of the feature: a test stores a reference, so editing the group changes what forty
 * tests do on their next run. Expanding at save time would merely be a faster way of making
 * forty copies.
 */

/** The step shape both a test and a group hold — the builder's, structurally. */
export interface SequenceStep {
  action?: { id?: string; name?: string } | null;
  targetElement?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

export interface LoadedStepGroup {
  id: string;
  name: string;
  sequence: SequenceStep[];
}

export interface ExpansionResult {
  steps: SequenceStep[];
  /**
   * Why the sequence could not be expanded as written.
   *
   * Never silently dropped: a test that calls a group somebody deleted must fail saying so.
   * Skipping the call would run a shorter test that still reports as a pass, which is the one
   * outcome worse than an error.
   */
  errors: string[];
  /** True when at least one call was replaced, so a caller can log that it happened. */
  expanded: boolean;
}

export function isGroupCall(step: SequenceStep | null | undefined): boolean {
  return step?.action?.id === STEP_GROUP_ACTION_ID;
}

/** The group a call names, or null when the step does not name one. */
export function groupIdOf(step: SequenceStep): string | null {
  const value = step.value;
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  // The builder may carry it as an object once the step has been round-tripped through a form.
  if (value && typeof value === 'object' && typeof (value as any).groupId === 'string') {
    return (value as any).groupId;
  }
  return null;
}

/** Every group a sequence calls, in order, without duplicates. */
export function referencedGroupIds(sequence: unknown): string[] {
  const steps = asSteps(sequence);
  const seen: string[] = [];
  for (const step of steps) {
    if (!isGroupCall(step)) continue;
    const id = groupIdOf(step);
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

/**
 * Replaces each call with the steps of the group it names.
 *
 * One level only. A group that calls another group is refused here and at save time, because
 * the alternative is a cycle: two groups that call each other expand forever, and the test
 * that triggers it takes the runner down rather than failing. Depth is a feature with a cost,
 * and nothing in the product needs it yet.
 */
export function expandStepGroups(sequence: unknown, groups: LoadedStepGroup[]): ExpansionResult {
  const steps = asSteps(sequence);
  const byId = new Map(groups.map((group) => [group.id, group]));
  const out: SequenceStep[] = [];
  const errors: string[] = [];
  let expanded = false;

  for (const step of steps) {
    if (!isGroupCall(step)) {
      out.push(step);
      continue;
    }

    const id = groupIdOf(step);
    if (!id) {
      errors.push('A step calls a step group but does not say which one.');
      continue;
    }
    const group = byId.get(id);
    if (!group) {
      // Named rather than described: the id is what someone has to look for, and the step's
      // own label is what they will recognise in the builder.
      errors.push(
        `This test calls the step group "${step.action?.name ?? id}" (${id}), which no longer exists.`,
      );
      continue;
    }

    const inner = asSteps(group.sequence);
    if (inner.some(isGroupCall)) {
      errors.push(`The step group "${group.name}" calls another step group, which is not supported.`);
      continue;
    }
    if (inner.length === 0) {
      errors.push(`The step group "${group.name}" has no steps.`);
      continue;
    }

    expanded = true;
    for (const innerStep of inner) {
      out.push({
        ...innerStep,
        action: {
          ...(innerStep.action ?? {}),
          // Says where the step came from, so a failure in the report points at the group
          // rather than at a step the test does not appear to contain.
          name: `${group.name} › ${innerStep.action?.name ?? innerStep.action?.id ?? 'step'}`,
        },
      });
    }
  }

  return { steps: out, errors, expanded };
}

/** Loads the groups a sequence needs, under the caller's organization. */
export async function loadReferencedGroups(sequence: unknown): Promise<LoadedStepGroup[]> {
  const ids = referencedGroupIds(sequence);
  if (ids.length === 0) return [];

  // No organization predicate: RLS supplies it, so a test that names another tenant's group
  // finds nothing and fails as if the group had been deleted — which, for this caller, it has.
  const rows = await withTenantTransaction((tx) => tx.select().from(stepGroups));
  return rows
    .filter((row) => ids.includes(row.id))
    .map((row) => ({ id: row.id, name: row.name, sequence: asSteps(row.sequence) }));
}

/**
 * Expands a sequence about to be run, loading whatever groups it names.
 *
 * Returns the sequence unchanged, and without touching the database, when nothing calls a
 * group — which is every test written before this existed.
 */
export async function expandSequenceForRun(sequence: unknown): Promise<ExpansionResult> {
  if (referencedGroupIds(sequence).length === 0) {
    return { steps: asSteps(sequence), errors: [], expanded: false };
  }
  try {
    return expandStepGroups(sequence, await loadReferencedGroups(sequence));
  } catch (error: any) {
    return {
      steps: asSteps(sequence),
      errors: [`Could not load the step groups this test calls: ${error?.message ?? error}`],
      expanded: false,
    };
  }
}

/** A sequence, whether the column handed it back parsed or as text. */
export function asSteps(sequence: unknown): SequenceStep[] {
  if (Array.isArray(sequence)) return sequence as SequenceStep[];
  if (typeof sequence === 'string') {
    try {
      const parsed = JSON.parse(sequence);
      return Array.isArray(parsed) ? (parsed as SequenceStep[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
