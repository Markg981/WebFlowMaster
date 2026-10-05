import { inArray } from 'drizzle-orm';
import { mobileStepGroups } from '@shared/schema';
import { mobileGroupSchema, type MobileGroupDefinition } from '@shared/mobile-groups';
import { type MobileStep, type MobilePlatform, type MobileExecutionStep } from '@shared/mobile';
import type { TenantTx } from './middleware/tenancy';
import { validateMobileExecution } from './mobile-flow';

export class MobileDefinitionError extends Error {
  readonly status = 400;
}
export function referencedMobileGroupIds(steps: readonly MobileStep[]): string[] {
  return [
    ...new Set(
      steps.filter((step) => step.action === 'callGroup').map((step) => step.value?.trim() ?? ''),
    ),
  ];
}
export function expandMobileGroups(
  steps: readonly MobileStep[],
  groups: MobileGroupDefinition[],
  platform: MobilePlatform,
): MobileExecutionStep[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const out: MobileExecutionStep[] = [];
  steps.forEach((step, index) => {
    if (step.action !== 'callGroup') out.push({ ...step, sourceIndex: index });
    else {
      const group = byId.get(step.value?.trim() ?? '');
      if (!group) throw new MobileDefinitionError('The mobile group is unavailable.');
      if (group.platform !== platform)
        throw new MobileDefinitionError('The mobile group has a different platform.');
      const parsed = mobileGroupSchema.safeParse(group);
      if (!parsed.success) throw new MobileDefinitionError(parsed.error.issues[0].message);
      out.push(
        ...parsed.data.steps.map((inner) => ({
          ...inner,
          sourceIndex: index,
          groupId: group.id,
          groupName: group.name,
        })),
      );
    }
    if (out.length > 2000) throw new MobileDefinitionError('Expanded mobile steps exceed 2000.');
  });
  try {
    validateMobileExecution(out, platform);
  } catch (error) {
    throw new MobileDefinitionError((error as Error).message);
  }
  return out;
}
export async function loadMobileGroups(
  tx: TenantTx,
  steps: readonly MobileStep[],
): Promise<MobileGroupDefinition[]> {
  const ids = referencedMobileGroupIds(steps);
  return ids.length
    ? tx.select().from(mobileStepGroups).where(inArray(mobileStepGroups.id, ids))
    : [];
}
export async function prepareMobileSteps(
  tx: TenantTx,
  definition: { steps: MobileStep[]; platform: MobilePlatform },
) {
  return expandMobileGroups(
    definition.steps,
    await loadMobileGroups(tx, definition.steps),
    definition.platform,
  );
}
