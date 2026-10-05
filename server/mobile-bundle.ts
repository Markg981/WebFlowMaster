import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { mobileTests, mobileStepGroups, type MobileTest } from '@shared/schema';
import { mobileTestSchema, type MobileStep } from '@shared/mobile';
import { mobileGroupSchema, type MobileGroupDefinition } from '@shared/mobile-groups';
import { prepareMobileSteps, expandMobileGroups } from './mobile-step-groups';
import { getTenantOrgId, type TenantTx } from './middleware/tenancy';
import { recordTypedTestVersion } from './test-version-store';
import { recordAudit, type auditActor } from './audit';
import { lockOrganizationRuns } from './tenant-quotas';

export const MOBILE_BUNDLE_FIELDS = [
  'name',
  'platform',
  'app',
  'deviceName',
  'osVersion',
  'deviceMatrix',
  'steps',
] as const;
export const mobileGroupKey = (platform: string, name: string) => JSON.stringify([platform, name]);
const groupIdentity = (platform: unknown, name: unknown) =>
  JSON.stringify([platform, String(name).trim().toLowerCase()]);
export function exportMobileCatalog(tests: MobileTest[], groups: MobileGroupDefinition[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const used = new Map<string, MobileGroupDefinition>();
  const nativeTests = [...tests]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((test) => {
      const steps = test.steps.map((step) => {
        if (step.action !== 'callGroup') return { ...step };
        const group = byId.get(step.value?.trim() ?? '');
        if (!group || group.platform !== test.platform)
          throw new Error('A mobile export references an unavailable or incompatible group.');
        used.set(group.id, group);
        return { ...step, value: mobileGroupKey(group.platform, group.name) };
      });
      return Object.fromEntries(
        MOBILE_BUNDLE_FIELDS.map((key) => [key, key === 'steps' ? steps : test[key]]),
      );
    });
  const nativeGroups = [...used.values()]
    .sort((a, b) =>
      mobileGroupKey(a.platform, a.name).localeCompare(mobileGroupKey(b.platform, b.name)),
    )
    .map((group) => ({
      key: mobileGroupKey(group.platform, group.name),
      name: group.name,
      platform: group.platform,
      description: group.description ?? null,
      steps: group.steps,
    }));
  return { mobileTests: nativeTests, mobileStepGroups: nativeGroups };
}
export interface MobileImportOutcome {
  kind: 'mobile_test' | 'mobile_step_group';
  name: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'invalid';
  reason?: string;
}
export async function importMobileCatalog(
  tx: TenantTx,
  options: {
    bundle: { mobileTests: Record<string, unknown>[]; mobileStepGroups: Record<string, unknown>[] };
    projectId: number | null;
    dryRun: boolean;
    userId: number;
    actor: ReturnType<typeof auditActor>;
    canEditProject: (id: number | null) => Promise<boolean>;
  },
): Promise<MobileImportOutcome[]> {
  const { bundle, projectId, dryRun, userId, actor, canEditProject } = options;
  if (!bundle.mobileTests.length && !bundle.mobileStepGroups.length) return [];
  await lockOrganizationRuns(tx, getTenantOrgId()!);
  const results: MobileImportOutcome[] = [];
  const groups = new Map<string, MobileGroupDefinition>();
  const counts = new Map<string, number>();
  for (const raw of bundle.mobileStepGroups) {
    const key = groupIdentity(raw.platform, raw.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const testCounts = new Map<string, number>();
  for (const raw of bundle.mobileTests) {
    const key = String(raw.name).trim().toLowerCase();
    testCounts.set(key, (testCounts.get(key) ?? 0) + 1);
  }
  const attempt = async (
    kind: MobileImportOutcome['kind'],
    name: string,
    fn: () => Promise<MobileImportOutcome['outcome']>,
  ) => {
    await tx.execute(sql`SAVEPOINT native_import_item`);
    try {
      const outcome = await fn();
      await tx.execute(sql`RELEASE SAVEPOINT native_import_item`);
      results.push({ kind, name, outcome });
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT native_import_item`);
      await tx.execute(sql`RELEASE SAVEPOINT native_import_item`);
      results.push({ kind, name, outcome: 'invalid', reason: (error as Error).message });
    }
  };
  for (const raw of bundle.mobileStepGroups)
    await attempt('mobile_step_group', String(raw.name ?? ''), async () => {
      if ((counts.get(groupIdentity(raw.platform, raw.name)) ?? 0) > 1)
        throw new Error('Duplicate native group key.');
      const candidate = mobileGroupSchema.parse({ ...raw, projectId });
      const key = mobileGroupKey(candidate.platform, candidate.name);
      if (raw.key !== key) throw new Error('The native group key does not match platform/name.');
      const matches = await tx
        .select()
        .from(mobileStepGroups)
        .where(
          sql`${mobileStepGroups.platform}=${candidate.platform} AND lower(${mobileStepGroups.name})=lower(${candidate.name})`,
        );
      if (matches.length > 1) throw new Error('Ambiguous destination group.');
      const existing = matches[0];
      if (!(await canEditProject(existing ? existing.projectId : projectId)))
        throw new Error('The group project cannot be edited.');
      const id = existing?.id ?? randomUUID();
      const unchanged =
        existing &&
        isDeepStrictEqual(
          [existing.name, existing.description, existing.steps],
          [candidate.name, candidate.description ?? null, candidate.steps],
        );
      if (!dryRun && !unchanged) {
        if (existing)
          await tx
            .update(mobileStepGroups)
            .set({ ...candidate, projectId: existing.projectId, updatedAt: new Date() })
            .where(eq(mobileStepGroups.id, id));
        else
          await tx
            .insert(mobileStepGroups)
            .values({ ...candidate, id, organizationId: getTenantOrgId()!, createdBy: userId });
      }
      groups.set(key, { ...candidate, id });
      return unchanged ? 'unchanged' : existing ? 'updated' : 'created';
    });
  for (const raw of bundle.mobileTests)
    await attempt('mobile_test', String(raw.name ?? ''), async () => {
      if ((testCounts.get(String(raw.name).trim().toLowerCase()) ?? 0) > 1)
        throw new Error('Duplicate native test name.');
      const steps = (raw.steps as MobileStep[] | undefined)?.map((step) => {
        if (step.action !== 'callGroup') return step;
        const group = groups.get(step.value ?? '');
        if (!group) throw new Error('An imported group dependency is invalid or missing.');
        return { ...step, value: group.id };
      });
      const candidate = mobileTestSchema.parse({ ...raw, steps, projectId, gridId: null });
      expandMobileGroups(candidate.steps, [...groups.values()], candidate.platform);
      const matches = await tx
        .select()
        .from(mobileTests)
        .where(sql`lower(${mobileTests.name})=lower(${candidate.name})`);
      if (matches.length > 1) throw new Error('Ambiguous destination test.');
      const existing = matches[0];
      if (existing && existing.platform !== candidate.platform)
        throw new Error('The destination test has a different platform.');
      if (!(await canEditProject(existing ? existing.projectId : projectId)))
        throw new Error('The test project cannot be edited.');
      const normalize = (value: unknown) => (value === undefined || value === null ? null : value);
      const unchanged =
        existing &&
        MOBILE_BUNDLE_FIELDS.every((key) =>
          isDeepStrictEqual(normalize(existing[key]), normalize(candidate[key])),
        );
      if (unchanged) return 'unchanged';
      if (!dryRun) {
        await prepareMobileSteps(tx, candidate);
        const fields = {
          ...candidate,
          projectId: existing ? existing.projectId : projectId,
          gridId: existing?.gridId ?? null,
        };
        const [row] = existing
          ? await tx
              .update(mobileTests)
              .set({ ...fields, updatedAt: new Date() })
              .where(eq(mobileTests.id, existing.id))
              .returning()
          : await tx
              .insert(mobileTests)
              .values({ ...fields, organizationId: getTenantOrgId()!, createdBy: userId })
              .returning();
        await recordTypedTestVersion(tx, {
          testType: 'mobile',
          testId: row.id,
          organizationId: getTenantOrgId()!,
          userId,
          test: row,
        });
        await recordAudit(tx, {
          action: 'test.imported',
          actor,
          targetType: 'mobile_test',
          targetId: row.id,
          metadata: { name: row.name },
        });
      }
      return existing ? 'updated' : 'created';
    });
  return results;
}
