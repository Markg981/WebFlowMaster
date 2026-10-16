import {
  checkArguments,
  customActionIdOf,
  parseArguments,
  type CustomActionParameter,
} from '@shared/custom-actions';
import { inArray } from 'drizzle-orm';
import { customActions } from '@shared/schema';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
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

/**
 * These custom actions, read in the caller's transaction. No organization predicate: RLS
 * supplies it, so another tenant's action is simply absent.
 */
export async function loadCustomActions(
  tx: TenantTx,
  ids: string[],
): Promise<Array<LoadedCustomAction & { updatedAt: Date | null }>> {
  if (ids.length === 0) return [];
  const rows = await tx.select().from(customActions).where(inArray(customActions.id, ids));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parameters: row.parameters ?? [],
    script: row.script,
    updatedAt: row.updatedAt ?? null,
  }));
}

/** Loads what a sequence calls, under the caller's organization, and expands it. */
export async function expandCustomActionsForRun(
  steps: SequenceStep[],
): Promise<{ steps: SequenceStep[]; errors: string[] }> {
  const ids = referencedCustomActionIds(steps);
  if (ids.length === 0) return { steps, errors: [] };
  try {
    const loaded = await withTenantTransaction((tx) => loadCustomActions(tx, ids));
    return expandCustomActions(
      steps,
      loaded.map(({ id, name, parameters, script }) => ({ id, name, parameters, script })),
    );
  } catch (error: any) {
    return {
      steps,
      errors: [`Could not load the custom actions this test uses: ${error?.message ?? error}`],
    };
  }
}
