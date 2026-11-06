import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/queryClient';
import type {
  HubResultStatus,
  HubStatusCounts,
  HubWaveAttempt,
  HubWaveImportParams,
  HubWaveSessionFilters,
} from '@shared/hub-waves';

/**
 * The QA hub's waves, as the client sees them: the sessions the QA team ran, their results,
 * and the background jobs that read them from the hub and turn them into WFM plans and runs.
 *
 * Errors arrive as `ApiError`s with the server's `{ error, code }`; `hubErrorMessage` from
 * useTestCaseHub translates them.
 */

export interface HubWaveRates {
  total: number;
  executed: number;
  executedPct: number;
  passRatePct: number;
}

export interface HubWaveSummary {
  id: number;
  waveId: string;
  name: string;
  description: string | null;
  release: string | null;
  majorRelease: string | null;
  waveType: string | null;
  status: string | null;
  startDate: string | null;
  targetDate: string | null;
  modules: string[];
  workbookLinks: Array<{ url: string; label: string | null }>;
  createdByName: string | null;
  entryCount: number;
  syncedAt: string;
  missingSince: string | null;
  testPlanId: string | null;
  executionId: string | null;
  materializedAt: string | null;
  counts: HubStatusCounts;
  rates: HubWaveRates;
  imported: boolean;
  changedSinceImport: boolean;
}

export interface HubWaveGroup {
  counts: HubStatusCounts;
  rates: HubWaveRates;
}

export interface HubWaveDetail extends HubWaveSummary {
  byModule: Array<HubWaveGroup & { module: string | null }>;
  byTester: Array<HubWaveGroup & { tester: string | null }>;
}

export type HubJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface HubJob {
  id: string;
  kind: 'waves_sync' | 'wave_import';
  status: HubJobStatus;
  params: Record<string, unknown>;
  progress: { phase?: string; done?: number; total?: number; current?: string | null };
  summary: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
}

export interface HubWavesOverview {
  waves: number;
  imported: number;
  cases: number;
  totals: HubStatusCounts;
  rates: HubWaveRates;
  trend: Array<{
    id: number;
    waveId: string;
    name: string;
    release: string | null;
    waveType: string | null;
    startDate: string | null;
    counts: HubStatusCounts;
    rates: HubWaveRates;
  }>;
  modules: Array<HubWaveGroup & { module: string | null }>;
  lastJob: HubJob | null;
}

export interface HubWaveResultRow {
  id: number;
  caseId: string;
  rawCaseId: string;
  module: string | null;
  definitionModule: string | null;
  assignedTester: string | null;
  stage: string | null;
  status: HubResultStatus;
  executedBy: string | null;
  executionDate: string | null;
  buildNumber: string | null;
  bugReference: string | null;
  bugPriority: string | null;
  notes: string | null;
  attempts: HubWaveAttempt[];
  attemptCount: number;
  featureHighlight: string | null;
  objective: string | null;
  testId: number | null;
  inCatalog: boolean;
}

export interface HubWaveResultFilters {
  module?: string;
  status?: HubResultStatus;
  tester?: string;
  stage?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface HubWaveResultPage {
  total: number;
  page: number;
  pageSize: number;
  results: HubWaveResultRow[];
}

export interface HubWaveSessionInput extends HubWaveSessionFilters {
  name?: string;
}

export interface HubWaveSessionResult {
  testPlanId: string;
  name: string;
  tests: number;
  notImported: number;
}

export const HUB_WAVES_KEY = ['/api/testcase-hub/waves'] as const;
export const HUB_JOBS_KEY = ['/api/testcase-hub/jobs'] as const;
const LIVE: ReadonlySet<HubJobStatus> = new Set(['queued', 'running']);

export function isLiveJob(job: Pick<HubJob, 'status'> | null | undefined): boolean {
  return !!job && LIVE.has(job.status);
}

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  return (await response.json()) as T;
}

export function useHubWaves(enabled = true) {
  return useQuery<HubWaveSummary[]>({
    queryKey: HUB_WAVES_KEY,
    queryFn: () => json<HubWaveSummary[]>('GET', '/api/testcase-hub/waves'),
    enabled,
  });
}

export function useHubWavesOverview(enabled = true) {
  return useQuery<HubWavesOverview>({
    queryKey: [...HUB_WAVES_KEY, 'overview'],
    queryFn: () => json<HubWavesOverview>('GET', '/api/testcase-hub/waves/overview'),
    enabled,
  });
}

export function useHubWave(id: number | null) {
  return useQuery<HubWaveDetail>({
    queryKey: [...HUB_WAVES_KEY, 'detail', id],
    queryFn: () => json<HubWaveDetail>('GET', `/api/testcase-hub/waves/${id}`),
    enabled: id !== null,
  });
}

export function hubWaveResultsUrl(id: number, filters: HubWaveResultFilters): string {
  const params = new URLSearchParams();
  if (filters.module) params.set('module', filters.module);
  if (filters.status) params.set('status', filters.status);
  if (filters.tester) params.set('tester', filters.tester);
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.q) params.set('q', filters.q);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 50));
  return `/api/testcase-hub/waves/${id}/results?${params}`;
}

export function useHubWaveResults(id: number | null, filters: HubWaveResultFilters) {
  return useQuery<HubWaveResultPage>({
    queryKey: [...HUB_WAVES_KEY, 'results', id, filters],
    queryFn: () => json<HubWaveResultPage>('GET', hubWaveResultsUrl(id ?? 0, filters)),
    enabled: id !== null,
    placeholderData: (previous) => previous,
  });
}

/**
 * One job, polled every second while it is live. When it ends, the waves and their numbers are
 * read again, and the library too after an import (new tests, a new plan and a run).
 */
export function useHubJob(jobId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<HubJob>({
    queryKey: [...HUB_JOBS_KEY, jobId],
    queryFn: async () => {
      const job = await json<HubJob>('GET', `/api/testcase-hub/jobs/${jobId}`);
      if (!isLiveJob(job)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: HUB_WAVES_KEY }),
          job.kind === 'wave_import' &&
            Promise.all([
              queryClient.invalidateQueries({ queryKey: ['/api/testcase-hub/cases'] }),
              queryClient.invalidateQueries({ queryKey: ['/api/testcase-hub/facets'] }),
              queryClient.invalidateQueries({ queryKey: ['/api/tests'] }),
              queryClient.invalidateQueries({ queryKey: ['/api/test-plans'] }),
            ]),
        ]);
      }
      return job;
    },
    enabled: jobId !== null,
    refetchInterval: (query) => (isLiveJob(query.state.data) ? 1000 : false),
  });
}

export function useSyncHubWaves() {
  return useMutation({
    mutationFn: () => json<HubJob>('POST', '/api/testcase-hub/waves/sync'),
  });
}

export function useImportHubWaves() {
  return useMutation({
    mutationFn: (input: HubWaveImportParams) =>
      json<HubJob>('POST', '/api/testcase-hub/waves/import', input),
  });
}

export function useCancelHubJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => json<HubJob>('POST', `/api/testcase-hub/jobs/${jobId}/cancel`),
    onSuccess: (job) => queryClient.setQueryData([...HUB_JOBS_KEY, job.id], job),
  });
}

export function useCreateWaveSession(waveRowId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HubWaveSessionInput) =>
      json<HubWaveSessionResult>('POST', `/api/testcase-hub/waves/${waveRowId}/session`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/test-plans'] }),
  });
}

/** The URL of a wave's export: one module's hub results file, or a CSV of the chosen modules. */
export function hubWaveExportUrl(
  id: number,
  options: { format: 'json'; module: string } | { format: 'csv'; modules?: string[] },
): string {
  const params = new URLSearchParams({ format: options.format });
  if (options.format === 'json') params.set('module', options.module);
  else if (options.modules?.length) params.set('modules', options.modules.join(','));
  return `/api/testcase-hub/waves/${id}/export?${params}`;
}
