export interface ExecutionProvenance {
  version: 1;
  capturedAt: string;
  inputFingerprint: string;
  datasetsFingerprint: string;
  datasets: Array<{ testId: number; rowCount: number; fingerprint: string; source?: { id: number; name: string; updatedAt: string }; unavailable: boolean }>;
  definitions: Array<{
    type: 'ui' | 'api' | 'mobile';
    id: number;
    name: string;
    version: number | null;
    source: 'published' | 'working';
    fingerprint: string;
  }>;
  liveDependencies: string[];
}

export interface ReproducibilitySummary {
  available: boolean;
  reason?: string;
  provenance?: ExecutionProvenance;
  replayOf?: { executionId: string; requestedAt: string };
}
