import { inArray } from 'drizzle-orm';
import { mobileTests, type MobileTest } from '@shared/schema';
import {
  mobileDeviceTargets,
  type MobileDeviceTarget,
  type MobileExecutionStep,
} from '@shared/mobile';
import type { TenantTx } from './middleware/tenancy';
import { currentContentOf } from './test-version-store';
import { publishedContentOf } from './test-publishing';
import { prepareMobileSteps } from './mobile-step-groups';

export type MobilePlanTarget = MobileDeviceTarget & { key: string };
export type FrozenMobileDefinition = {
  id: number;
  definition: MobileTest & { executionSteps?: MobileExecutionStep[]; preparationError?: string };
  version?: number;
};
export const mobilePlanTargets = (
  test: Parameters<typeof mobileDeviceTargets>[0],
): MobilePlanTarget[] =>
  mobileDeviceTargets(test).map((target, index) => ({ ...target, key: `device-${index}` }));
export async function freezeMobilePlanDefinitions(
  tx: TenantTx,
  ids: number[],
): Promise<FrozenMobileDefinition[]> {
  if (!ids.length) return [];
  const rows = await tx.select().from(mobileTests).where(inArray(mobileTests.id, ids));
  const current = await currentContentOf(tx, ids, 'mobile');
  const published = await publishedContentOf(tx, ids, 'mobile');
  const frozen: FrozenMobileDefinition[] = [];
  for (const row of rows) {
    const content = published.get(row.id) ?? current.get(row.id);
    const definition = { ...row, ...content?.snapshot } as FrozenMobileDefinition['definition'];
    try {
      definition.executionSteps = await prepareMobileSteps(tx, definition);
    } catch (error) {
      definition.preparationError = (error as Error).message;
    }
    frozen.push({ id: row.id, definition, version: content?.version });
  }
  return frozen;
}
