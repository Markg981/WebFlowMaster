import type { BddAgentProfile } from '@shared/bdd-agent';
export interface BddProfile {
  id: string;
  name: string;
  pool: string;
  operatorProfileId: string;
  revision: string;
  projectId: number | null;
  timeoutMs: number;
}
export type AdvertisedBddProfile = BddAgentProfile & { pool: string; connected: boolean };
export async function bddRequest<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
