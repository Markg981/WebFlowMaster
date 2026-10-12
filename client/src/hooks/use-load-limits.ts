import { useQuery } from '@tanstack/react-query';
import { LOAD_LIMITS } from '@shared/load-test';

/**
 * The load-test limits of this installation (GET /api/load-tests/limits): virtual users and
 * duration are server configuration (LOAD_MAX_VIRTUAL_USERS, LOAD_MAX_DURATION_S), so a dialog
 * clamping its inputs with the shipped LOAD_LIMITS would make a raised limit unusable and leave a
 * lowered one to be refused by the server. While the request is in flight, or when it fails, the
 * shipped constants stand in: the server checks again on save, naming the limit.
 */

export interface EffectiveLoadLimits {
  virtualUsers: number;
  durationSec: number;
  stages: number;
  steps: number;
  thinkTimeMs: number;
  runsPerOrganization: number;
}

export const LOAD_LIMITS_QUERY_KEY = ['loadTests', 'limits'] as const;

/** The shipped limits, the fallback of the hook. */
export const DEFAULT_LOAD_LIMITS: EffectiveLoadLimits = {
  virtualUsers: LOAD_LIMITS.virtualUsers,
  durationSec: LOAD_LIMITS.durationSec,
  stages: LOAD_LIMITS.stages,
  steps: LOAD_LIMITS.steps,
  thinkTimeMs: LOAD_LIMITS.thinkTimeMs,
  runsPerOrganization: LOAD_LIMITS.runsPerOrganization,
};

const LIMIT_KEYS = Object.keys(DEFAULT_LOAD_LIMITS) as Array<keyof EffectiveLoadLimits>;

/** The body of the limits endpoint over the shipped values: a field that is not a positive number keeps its default. */
export function parseLoadLimits(body: unknown): EffectiveLoadLimits {
  const limits = { ...DEFAULT_LOAD_LIMITS };
  if (!body || typeof body !== 'object') return limits;
  const record = body as Record<string, unknown>;
  for (const key of LIMIT_KEYS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      limits[key] = Math.floor(value);
    }
  }
  return limits;
}

export async function fetchLoadLimits(): Promise<EffectiveLoadLimits> {
  const response = await fetch('/api/load-tests/limits', { credentials: 'include' });
  if (!response.ok) throw new Error(`${response.status}: the load limits could not be read`);
  return parseLoadLimits(await response.json());
}

export function useLoadLimits(options: { enabled?: boolean } = {}) {
  const query = useQuery<EffectiveLoadLimits, Error>({
    queryKey: LOAD_LIMITS_QUERY_KEY,
    queryFn: fetchLoadLimits,
    staleTime: 5 * 60_000,
    enabled: options.enabled,
  });
  return {
    /** Always usable: the installation's limits once read, the shipped ones until then or on error. */
    limits: query.data ?? DEFAULT_LOAD_LIMITS,
    /** True once the limits came from the server rather than the shipped constants. */
    isFromServer: query.data !== undefined,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
