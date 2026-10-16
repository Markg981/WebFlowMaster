export interface ExecutionProvenance {
  version: 1;
  capturedAt: string;
  inputFingerprint: string;
  datasetsFingerprint: string;
  datasets: Array<{
    testId: number;
    rowCount: number;
    fingerprint: string;
    source?: { id: number; name: string; updatedAt: string };
    unavailable: boolean;
  }>;
  definitions: Array<{
    type: 'ui' | 'api' | 'mobile';
    id: number;
    name: string;
    version: number | null;
    source: 'published' | 'working';
    fingerprint: string;
    /**
     * What a UI definition calls (step groups, shared elements, custom actions), frozen with it.
     * `version`: the bundle recorded with the published version its review saw. `enqueue`: a
     * working copy, or a version from before bundles, captured when the run was queued.
     * `unusable`: the recorded bundle is corrupt or in an unknown format; the test fails rather
     * than run with live dependencies. Absent on runs queued before R1, which read them live.
     */
    dependencies?: {
      origin: 'version' | 'enqueue' | 'unusable';
      fingerprint: string | null;
      groups: number;
      elements: number;
      customActions: number;
      missing: number;
    };
  }>;
  liveDependencies: string[];
}

/**
 * The data protocols this release reads (R1, C04). Anything else is refused explicitly, never
 * executed by falling back to the live plan or to live dependencies.
 */
export const SUPPORTED_EXECUTION_PROTOCOLS = {
  /** `configuration_snapshot.version`; '{}' is a run from before snapshots (legacy). */
  snapshot: [1],
  /** `configuration_snapshot.definitions.version`: 1 without dependencies, 2 with them. */
  definitions: [1, 2],
  /** A dependency bundle's `protocol`, in a UI version or a frozen definition. */
  dependencyBundle: [1],
} as const;

export interface ReproducibilitySummary {
  available: boolean;
  reason?: string;
  provenance?: ExecutionProvenance;
  replayOf?: { executionId: string; requestedAt: string };
}
