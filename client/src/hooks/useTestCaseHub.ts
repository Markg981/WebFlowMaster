import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { ApiError, apiRequest, errorMessage } from '@/lib/queryClient';
import type { ManualStep } from '@shared/manual-tests';

/**
 * The QA test case hub, as the client sees it: one source per organization, the catalog read
 * from it, and the import that turns chosen cases into manual tests.
 *
 * Every request goes through `apiRequest`, so a failure arrives as an `ApiError` whose body is
 * the server's `{ error, code }`. `hubErrorMessage` turns the code into the person's language and
 * keeps the server's sentence for a code it does not know.
 */

export type HubSourceKind = 'folder' | 'azure-devops';

export interface HubSourceSummary {
  id: string;
  kind: HubSourceKind;
  name: string;
  path: string | null;
  baseUrl: string | null;
  project: string | null;
  repository: string | null;
  branch: string | null;
  hasToken: boolean;
  lastRefreshAt: string | null;
  lastRefreshHead: string | null;
  lastRefreshStatus: 'ok' | 'failed' | null;
  lastRefreshError: string | null;
  caseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HubSourceInput {
  kind: HubSourceKind;
  name: string;
  path?: string;
  baseUrl?: string;
  project?: string;
  repository?: string;
  branch?: string;
  token?: string;
}

export interface HubCaseRow {
  id: number;
  caseId: string;
  module: string;
  executionModule: string | null;
  status: 'active' | 'deprecated';
  priority: string | null;
  readinessLevel: number;
  versionFrom: string | null;
  versionTo: string | null;
  featureHighlight: string | null;
  executionGroup: string | null;
  functionalObjective: string;
  dependsOn: string[];
  sourceUpdatedAt: string | null;
  missingSince: string | null;
  testId: number | null;
  importedAt: string | null;
  changedSinceImport: boolean;
}

export interface HubCaseDetail extends HubCaseRow {
  rawId: string;
  devopsId: string | null;
  sme: string | null;
  precondition: string;
  steps: string;
  expectedOutcome: string;
  refEnvPrecondition: string;
  refEnvSteps: string;
  refEnvExpectedOutcome: string;
  forceNotTested: boolean;
  refreshedAt: string;
  importedBy: number | null;
  test: { id: number; name: string; updatedAt: string | null } | null;
  testName: string;
  preview: { standard: ManualStep[]; reference: ManualStep[] | null };
}

export interface HubFacet<T = string> {
  value: T;
  count: number;
}

export interface HubFacets {
  modules: HubFacet[];
  statuses: HubFacet[];
  priorities: HubFacet<string | null>[];
  readiness: HubFacet<number>[];
  total: number;
  imported: number;
  changed: number;
  missing: number;
}

export interface HubCaseFilters {
  module?: string;
  status?: 'active' | 'deprecated' | 'all';
  priority?: string;
  readiness?: number;
  q?: string;
  imported?: 'yes' | 'no' | 'changed' | 'all';
  missing?: 'include' | 'exclude' | 'only';
  page?: number;
  pageSize?: number;
}

export interface HubCasePage {
  rows: HubCaseRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HubRefreshResult {
  source: HubSourceSummary;
  cases: number;
  added: number;
  updated: number;
  missing: number;
  head: string | null;
  warnings: number;
  warningSample: string[];
}

export interface HubImportInput {
  caseIds: string[];
  projectId: number | null;
  suiteId?: number;
  newSuiteName?: string;
  variant: 'standard' | 'reference';
}

export type HubImportOutcome = 'created' | 'updated' | 'unchanged' | 'skipped';
export type HubSkipReason = 'name_conflict' | 'not_manual' | 'missing_in_hub' | 'not_in_catalog';

export interface HubImportedCase {
  caseId: string;
  outcome: HubImportOutcome;
  testId: number | null;
  reason?: HubSkipReason;
}

export interface HubImportResult {
  cases: HubImportedCase[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  suiteId: number | null;
}

/** The most cases one import may take; mirrors HUB_IMPORT_MAX_CASES on the server. */
export const HUB_IMPORT_MAX_CASES = 500;

export const HUB_SOURCE_KEY = ['/api/testcase-hub'] as const;
export const HUB_CASES_KEY = ['/api/testcase-hub/cases'] as const;
export const HUB_FACETS_KEY = ['/api/testcase-hub/facets'] as const;

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** The server's error code for a failed hub request, when it sent one. */
export function hubErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  return null;
}

/** A sentence for the person: the translated code when there is one, else the server's own. */
export function hubErrorMessage(error: unknown, t: TFunction): string {
  const fallback = errorMessage(error);
  const code = hubErrorCode(error);
  if (!code) return fallback;
  const key = `testCaseHub.errors.${code}`;
  const translated = t(key, { defaultValue: '' });
  return translated || fallback;
}

export function useHubSource() {
  return useQuery<HubSourceSummary | null>({
    queryKey: HUB_SOURCE_KEY,
    queryFn: () => json<HubSourceSummary | null>('GET', '/api/testcase-hub'),
  });
}

function hubCasesUrl(filters: HubCaseFilters): string {
  const params = new URLSearchParams();
  if (filters.module) params.set('module', filters.module);
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.readiness !== undefined) params.set('readiness', String(filters.readiness));
  if (filters.q) params.set('q', filters.q);
  if (filters.imported) params.set('imported', filters.imported);
  if (filters.missing) params.set('missing', filters.missing);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 50));
  return `/api/testcase-hub/cases?${params}`;
}

export function useHubCases(filters: HubCaseFilters, enabled = true) {
  return useQuery<HubCasePage>({
    queryKey: [...HUB_CASES_KEY, filters],
    queryFn: () => json<HubCasePage>('GET', hubCasesUrl(filters)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useHubFacets(enabled = true) {
  return useQuery<HubFacets>({
    queryKey: HUB_FACETS_KEY,
    queryFn: () => json<HubFacets>('GET', '/api/testcase-hub/facets'),
    enabled,
  });
}

export function useHubCase(caseId: string | null) {
  return useQuery<HubCaseDetail>({
    queryKey: [...HUB_CASES_KEY, 'detail', caseId],
    queryFn: () =>
      json<HubCaseDetail>('GET', `/api/testcase-hub/cases/${encodeURIComponent(caseId ?? '')}`),
    enabled: caseId !== null,
  });
}

/** Everything the catalog shows, after a refresh, an import or a change of source. */
function useInvalidateHub() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: HUB_SOURCE_KEY }),
      queryClient.invalidateQueries({ queryKey: HUB_CASES_KEY }),
      queryClient.invalidateQueries({ queryKey: HUB_FACETS_KEY }),
    ]);
}

export function useSaveHubSource() {
  const invalidate = useInvalidateHub();
  return useMutation({
    mutationFn: (input: HubSourceInput) =>
      json<HubSourceSummary>('PUT', '/api/testcase-hub', input),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveHubSource() {
  const invalidate = useInvalidateHub();
  return useMutation({
    mutationFn: () => json<void>('DELETE', '/api/testcase-hub'),
    onSuccess: () => invalidate(),
  });
}

export function useCheckHubSource() {
  return useMutation({
    mutationFn: () => json<{ ok: boolean; detail: string }>('POST', '/api/testcase-hub/test'),
  });
}

export function useRefreshHub() {
  const invalidate = useInvalidateHub();
  return useMutation({
    mutationFn: () => json<HubRefreshResult>('POST', '/api/testcase-hub/refresh'),
    // The source row records a failed refresh too, so the card shows it either way.
    onSettled: () => invalidate(),
  });
}

export function useImportHubCases() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateHub();
  return useMutation({
    mutationFn: (input: HubImportInput) =>
      json<HubImportResult>('POST', '/api/testcase-hub/import', input),
    onSuccess: async () => {
      await invalidate();
      // The imported cases are library tests now, and may sit in a suite.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/tests'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/suites'] }),
      ]);
    },
  });
}
