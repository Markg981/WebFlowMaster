export const QUOTA_MODES = ['off', 'monitor', 'enforce'] as const;
export type QuotaMode = typeof QUOTA_MODES[number];
export interface TenantQuotas {
  mode: QuotaMode;
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
  maxTests: number;
  maxArtifactBytes: number;
  maxMonthlyExecutionMinutes: number;
}
export type QuotaOverrides = { [K in keyof TenantQuotas]: TenantQuotas[K] | null };
export interface QuotaUsage {
  tests: number;
  artifactBytes: number;
  reservedArtifactBytes: number;
  executionMs: number;
  periodStart: string;
  periodEnd: string;
  artifactsReconciledAt: string | null;
}
export interface OrganizationQuotaSummary {
  organizationId: number;
  name: string;
  revision: number;
  quotas: TenantQuotas;
  overrides: QuotaOverrides;
  usage: QuotaUsage & { running: number; queued: number };
}

export function quotaDefaults(env: Record<string, string | undefined>): TenantQuotas {
  const integer = (key: string, fallback: number, minimum = 0) => {
    const value = Number(env[key]);
    return Number.isSafeInteger(value) && value >= minimum && env[key]?.trim() ? value : fallback;
  };
  return {
    mode: QUOTA_MODES.includes(env.TENANT_QUOTA_MODE as QuotaMode) ? env.TENANT_QUOTA_MODE as QuotaMode : 'enforce',
    maxConcurrentRuns: Math.min(2_147_483_647, integer('ORG_MAX_CONCURRENT_RUNS', 2, 1)),
    maxQueuedRuns: Math.min(2_147_483_647, integer('ORG_MAX_QUEUED_RUNS', 100, 1)),
    maxTests: integer('ORG_MAX_TESTS', 0),
    maxArtifactBytes: integer('ORG_MAX_ARTIFACT_BYTES', 0),
    maxMonthlyExecutionMinutes: integer('ORG_MAX_MONTHLY_EXECUTION_MINUTES', 0),
  };
}
