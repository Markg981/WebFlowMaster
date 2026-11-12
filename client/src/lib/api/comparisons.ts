import type {
  CheckpointCapture,
  ComparisonDifference,
  ComparisonMode,
  ComparisonPolicy,
  ComparisonResultVerdict,
  ComparisonReviewStatus,
  ComparisonStatus,
  ComparisonSummary,
  ComparisonVerdict,
  CreateKnownDifferenceInput,
  DifferenceKind,
  KnownDifferenceScope,
} from '@shared/comparison';

/**
 * What the comparison routes answer (server/http/routes/comparisons.routes.ts), and the calls
 * the pages make. A comparison runs one plan on a baseline environment, replays it on a
 * candidate one, and pairs the two runs' results test by test.
 */

export interface ComparisonSide {
  environmentId: number | null;
  environmentName: string;
  executionId: string | null;
}

export interface ComparisonView {
  id: string;
  planId: string;
  planName: string | null;
  name: string | null;
  mode: ComparisonMode;
  status: ComparisonStatus;
  verdict: ComparisonVerdict | null;
  summary: ComparisonSummary | null;
  baseline: ComparisonSide;
  candidate: ComparisonSide;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ComparisonRunView {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ComparisonDetail extends ComparisonView {
  baselineRun: ComparisonRunView | null;
  candidateRun: ComparisonRunView | null;
}

export interface ComparisonResultRow {
  id: string;
  testType: string;
  testName: string;
  browser: string | null;
  module: string | null;
  component: string | null;
  verdict: ComparisonResultVerdict;
  differenceCount: number;
  reviewStatus: ComparisonReviewStatus;
}

export interface ComparedStepView {
  key: string;
  index: number;
  stepId: string | null;
  name: string | null;
  status: string | null;
  screenshot: string | null;
  checkpoint: CheckpointCapture | null;
}

export interface ComparisonResultDetail extends ComparisonResultRow {
  hidden: boolean;
  uiTestId: number | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  differences: ComparisonDifference[];
  steps: { baseline: ComparedStepView[]; candidate: ComparedStepView[] } | null;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status}`);
  return body as T;
}

async function post<T>(url: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `${response.status}`);
  return payload as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const listComparisons = (params: { planId?: string; page?: number; pageSize?: number }) =>
  read<Page<ComparisonView>>(`/api/comparisons${query(params)}`);

export const getComparison = (id: string) => read<ComparisonDetail>(`/api/comparisons/${id}`);

export const listComparisonResults = (
  id: string,
  params: { verdict?: string; module?: string; page?: number; pageSize?: number },
) => read<Page<ComparisonResultRow>>(`/api/comparisons/${id}/results${query(params)}`);

export const getComparisonResult = (id: string, resultId: string) =>
  read<ComparisonResultDetail>(`/api/comparisons/${id}/results/${resultId}`);

export const startComparison = (
  planId: string,
  body: {
    baselineEnvironmentId: number;
    candidateEnvironmentId: number;
    mode: ComparisonMode;
    name?: string;
    policy?: ComparisonPolicy;
  },
  idempotencyKey: string,
) =>
  post<{ id: string; status: ComparisonStatus; created: boolean }>(
    `/api/test-plans/${planId}/comparisons`,
    body,
    idempotencyKey,
  );

export const cancelComparison = (id: string) =>
  post<{ status: ComparisonStatus }>(`/api/comparisons/${id}/cancel`, {});

/** A recorded known difference: later comparisons mark the differences it covers as expected. */
export interface KnownDifferenceView {
  id: string;
  projectId: number | null;
  projectName: string | null;
  uiTestId: number | null;
  testName: string | null;
  checkpointName: string | null;
  kind: DifferenceKind;
  pathPattern: string | null;
  reason: string;
  reference: string | null;
  approvedByUserId: number | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface ReviewedResult extends ComparisonResultRow {
  reviewNote: string | null;
  reviewedAt: string | null;
}

export const reviewComparisonResult = (
  id: string,
  resultId: string,
  body: {
    status: ComparisonReviewStatus;
    note?: string;
    saveAsKnownDifference?: {
      scope?: KnownDifferenceScope;
      reference?: string;
      expiresAt?: string;
      differences?: number[];
    };
  },
) =>
  post<{ result: ReviewedResult; knownDifferences: KnownDifferenceView[] }>(
    `/api/comparisons/${id}/results/${resultId}/review`,
    body,
  );

export const listKnownDifferences = (params: {
  projectId?: number;
  uiTestId?: number;
  page?: number;
  pageSize?: number;
}) => read<Page<KnownDifferenceView>>(`/api/comparison-known-differences${query(params)}`);

export const createKnownDifference = (body: CreateKnownDifferenceInput) =>
  post<KnownDifferenceView>('/api/comparison-known-differences', body);

export async function deleteKnownDifference(id: string): Promise<void> {
  const response = await fetch(`/api/comparison-known-differences/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${response.status}`);
  }
}

/** A fresh key per attempt: retrying the same click does not start a second comparison. */
export function newIdempotencyKey(): string {
  return (
    crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('')
  );
}
