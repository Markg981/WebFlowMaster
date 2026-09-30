import {
  checkArguments,
  customActionIdOf,
  parseArguments,
  type CustomActionParameter,
} from '@shared/custom-actions';
import { customActions } from '@shared/schema';
import { withTenantTransaction } from './middleware/tenancy';
import type { SequenceStep } from './step-groups';

/**
 * Turning a call to a custom action into the step that runs it.
 *
 * At run time, like a step group, so the test runs the action as it is now. The call becomes an
 * ordinary `executeScript` step carrying its arguments: the executor, the flow cursor, the
 * report and every runner then treat it like any other step, and nothing about running a custom
 * action exists in a second place that could drift.
 */

export interface LoadedCustomAction {
  id: string;
  name: string;
  parameters: CustomActionParameter[];
  script: string;
}

/** Every custom action a sequence calls, without duplicates. */
export function referencedCustomActionIds(steps: SequenceStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    const id = customActionIdOf(step.action?.id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function expandCustomActions(
  steps: SequenceStep[],
  actions: LoadedCustomAction[],
): { steps: SequenceStep[]; errors: string[] } {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const out: SequenceStep[] = [];
  const errors: string[] = [];

  for (const step of steps) {
    const id = customActionIdOf(step.action?.id);
    if (!id) {
      out.push(step);
      continue;
    }
    const label = step.action?.name ?? id;
    const action = byId.get(id);
    if (!action) {
      // Refused, never skipped: a shorter test that still passes is the worst outcome.
      errors.push(`This test uses the custom action "${label}" (${id}), which no longer exists.`);
      continue;
    }
    const parsed = parseArguments(typeof step.value === 'string' ? step.value : '');
    if ('error' in parsed) {
      errors.push(`Custom action "${action.name}": ${parsed.error}`);
      continue;
    }
    const mismatch = checkArguments(action.parameters, parsed.args);
    if (mismatch) {
      errors.push(`Custom action "${action.name}": ${mismatch}`);
      continue;
    }
    out.push({
      ...step,
      // The report names the action, not "Run JavaScript".
      action: { ...(step.action ?? {}), id: 'executeScript', name: action.name },
      value: action.script,
      args: parsed.args,
    });
  }
  return { steps: out, errors };
}

/** Loads what a sequence calls, under the caller's organization, and expands it. */
export async function expandCustomActionsForRun(steps: SequenceStep[]): Promise<{ steps: SequenceStep[]; errors: string[] }> {
  const ids = referencedCustomActionIds(steps);
  if (ids.length === 0) return { steps, errors: [] };
  try {
    // No organization predicate: RLS supplies it, so another tenant's action is simply absent.
    const rows = await withTenantTransaction((tx) => tx.select().from(customActions));
    const loaded = rows
      .filter((row) => ids.includes(row.id))
      .map((row) => ({ id: row.id, name: row.name, parameters: row.parameters ?? [], script: row.script }));
    return expandCustomActions(steps, loaded);
  } catch (error: any) {
    return { steps, errors: [`Could not load the custom actions this test uses: ${error?.message ?? error}`] };
  }
}
