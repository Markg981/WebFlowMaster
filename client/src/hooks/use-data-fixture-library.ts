import { useQuery } from '@tanstack/react-query';
import type { LibraryFixtureDefinition } from '@shared/schema';

/**
 * The project's data fixture library (server/http/routes/data-fixtures.routes.ts): fixtures kept
 * once, in versions, that a test names instead of copying their SQL.
 */

export interface LibraryFixtureSummary {
  id: number;
  projectId: number;
  key: string;
  name: string;
  description: string | null;
  tags: string[];
  currentVersion: number;
  updatedAt: string;
  /** The current version's definition. */
  definition: LibraryFixtureDefinition;
}

export interface LibraryFixtureVersion {
  version: number;
  definition: LibraryFixtureDefinition;
  note: string | null;
  createdAt: string;
}

export interface LibraryFixtureDetail extends Omit<LibraryFixtureSummary, 'definition'> {
  /** Newest first. */
  versions: LibraryFixtureVersion[];
}

export interface LibraryFixtureReferences {
  tests: Array<{ id: number; name: string }>;
  fixtures: Array<{ id: number; key: string; name: string }>;
}

export interface FixtureTryStep {
  id: string;
  name: string;
  alias: string;
  status: 'satisfied' | 'applied' | 'missing' | 'failed';
  detail: string;
  durationMs: number;
  outputs: Record<string, string>;
  source?: string;
}

export interface FixtureTryResult {
  ok: boolean;
  steps: FixtureTryStep[];
  failedAt?: string;
  reason?: string;
}

/** A request that throws the server's own message, so a 400 reads as what is wrong. */
export async function libraryCall<T>(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
    credentials: 'include',
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(answer?.error || `Request failed (${res.status})`) as Error & {
      body?: unknown;
    };
    error.body = answer;
    throw error;
  }
  return answer as T;
}

export const libraryKey = (projectId: number | null | undefined) =>
  ['dataFixtureLibrary', projectId ?? null] as const;

export function useFixtureLibrary(projectId: number | null | undefined) {
  return useQuery<LibraryFixtureSummary[]>({
    queryKey: libraryKey(projectId),
    enabled: !!projectId,
    queryFn: async ({ signal }) => {
      const data = await libraryCall<unknown>(
        'GET',
        `/api/projects/${projectId}/data-fixtures`,
        undefined,
        signal,
      );
      return Array.isArray(data) ? (data as LibraryFixtureSummary[]) : [];
    },
  });
}

export function useFixtureDetail(id: number | null) {
  return useQuery<LibraryFixtureDetail>({
    queryKey: ['dataFixtureLibrary', 'detail', id],
    enabled: !!id,
    queryFn: ({ signal }) => libraryCall('GET', `/api/data-fixtures/${id}`, undefined, signal),
  });
}

export function useFixtureReferences(id: number | null) {
  return useQuery<LibraryFixtureReferences>({
    queryKey: ['dataFixtureLibrary', 'references', id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      libraryCall('GET', `/api/data-fixtures/${id}/references`, undefined, signal),
  });
}

/** The keys a fixture needs, in the order they run, from the project's list. */
export function dependencyChain(key: string, library: LibraryFixtureSummary[]): string[] {
  const byKey = new Map(library.map((f) => [f.key, f]));
  const order: string[] = [];
  const visit = (current: string, path: string[]) => {
    if (path.includes(current)) return;
    for (const dep of byKey.get(current)?.definition.dependsOn ?? [])
      visit(dep.fixture, [...path, current]);
    if (!order.includes(current)) order.push(current);
  };
  visit(key, []);
  return order;
}
