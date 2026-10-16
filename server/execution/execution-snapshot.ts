import { EVIDENCE_CAPTURE_MODES, type EvidenceCaptureMode, type TestPlan } from '@shared/schema';
import type { WorkerLossPolicy } from '@shared/execution-identity';
import type { RunSelection } from './test-impact';
import { normalizeLocales } from '@shared/locales';

/**
 * What a run was asked to do, written down when it was asked.
 *
 * A queued run carried only the plan's id, and the worker read the plan whenever it got to the
 * run. A plan edited while a run waited therefore ran with settings nobody had chosen for that
 * run — another browser, another set of tests, notifications going somewhere new — and its
 * report described a configuration that was never the one requested.
 *
 * Every setting the runner reads is in here. That is the contract, and it is what the first
 * attempt at this got wrong: its snapshot was written before the browser matrix, parallelism,
 * visual testing, video and trace, and issue filing existed, and a worker that ran from it
 * would have quietly stopped doing all of them. Adding a plan setting that the runner reads
 * means adding it here, and the snapshot test lists them so a missing one is a failing test
 * rather than a feature that silently stops working.
 *
 * Pure: no database, no clock except the one passed in. What goes in is decided by the enqueue
 * path; what comes out is read by the worker.
 */

export const EXECUTION_SNAPSHOT_VERSION = 1 as const;

export interface SnapshotTestReference {
  testType: 'ui' | 'api' | 'mobile';
  testId: number | null;
  apiTestId: number | null;
  /** Present for a mobile app test (migration 0053); absent in snapshots taken before. */
  mobileTestId?: number | null;
}

export interface ExecutionSnapshot {
  definitions?: import('./execution-definitions').FrozenTestDefinitions;
  provenance?: import('@shared/execution-provenance').ExecutionProvenance;
  replayOf?: { executionId: string; requestedAt: string };
  /** Absent on historical runs; present even when there are no shared values or rows. */
  datasets?: import('./execution-datasets').FrozenExecutionDatasets;
  mobileDefinitions?: import('../mobile/mobile-plan-units').FrozenMobileDefinition[];
  version: typeof EXECUTION_SNAPSHOT_VERSION;
  capturedAt: string;
  plan: { id: string; name: string; updatedAt: string | null };
  environmentId: number | null;
  /**
   * The two sources the browser matrix is derived from, kept as they were rather than resolved:
   * the worker resolves them with server/runtime/browsers.ts, so which browsers exist on the runner is
   * decided where the browsers are, and the request still cannot be changed after the fact.
   */
  browsers: { requested: unknown; testMachines: unknown };
  /** In plan order, fixed at enqueue: a test added to the plan later is not in this run. */
  selectedTests: SnapshotTestReference[];
  visualTesting: { enabled: boolean; updateBaselines: boolean };
  /** `network` is absent on snapshots taken before it existed, and read as 'never'. */
  evidence: {
    video: EvidenceCaptureMode;
    trace: EvidenceCaptureMode;
    network?: EvidenceCaptureMode;
  };
  maxParallelTests: number;
  /** Workers sharing the run (server/runtime/run-shards.ts); absent on snapshots from before it existed, read as 1. */
  shards?: number;
  /**
   * What a lost worker's work becomes (shared/execution-identity.ts). Absent on older snapshots:
   * indeterminate, never a replay inferred from anything else.
   */
  workerLossPolicy?: WorkerLossPolicy;
  captureScreenshots: string;
  /** As the plan stored them; server/runtime/run-policies.ts reads them, units and all. */
  timeouts: { pageLoadMs: number; elementMs: number };
  failurePolicies: {
    onMajorStepFailure: string;
    onAbortedTestCase: string;
    onTestSuitePreRequisiteFailure: string;
    onTestCasePreRequisiteFailure: string;
    onTestStepPreRequisiteFailure: string;
  };
  rerunPolicy: string;
  /** The plan's own settings; a schedule's override is still read from the schedule when it ends. */
  notificationSettings: unknown;
  issues: { trackerId: string | null; createOnFailure: boolean };
  /**
   * Where the browsers come from: the local agents of a pool (shared/agents.ts), or the runner's
   * own when null. Absent on snapshots taken before agents existed, which ran on the runner.
   */
  runOn?: { agentPool: string | null; browserGridId?: string | null };
  /** Languages every test runs in (shared/locales.ts). Absent on older snapshots: none. */
  locales?: string[];
  /**
   * The TestRail, Xray or Zephyr Scale the finished run is published to (server/integrations/test-management.ts).
   * Absent on older snapshots: published nowhere.
   */
  testManagement?: { connectionId: string | null };
  /** Present when the run was narrowed to the tests a change affects (server/execution/test-impact.ts). */
  selection?: RunSelection;
}

/** What the request may say that the plan does not. Anything absent comes from the plan. */
export interface SnapshotOverrides {
  environmentId?: number | null;
  browsers?: unknown;
  updateBaselines?: boolean;
}

function evidenceMode(value: unknown): EvidenceCaptureMode {
  return (EVIDENCE_CAPTURE_MODES as readonly string[]).includes(value as string)
    ? (value as EvidenceCaptureMode)
    : 'never';
}

/** A jsonb column that came back as text, as these sometimes do, read as what it holds. */
function parsedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The snapshot of a plan as it is right now.
 *
 * Used at enqueue time, and by the worker for a run that has none — every run queued before
 * snapshots existed, and scheduled runs until the scheduler goes through the same command. For
 * those the plan as it is when the worker takes the run is the best record there is, which is
 * what they always used.
 */
export function buildExecutionSnapshot(
  plan: TestPlan,
  selectedTests: SnapshotTestReference[],
  overrides: SnapshotOverrides = {},
  now: Date = new Date(),
): ExecutionSnapshot {
  return {
    version: EXECUTION_SNAPSHOT_VERSION,
    capturedAt: now.toISOString(),
    plan: {
      id: plan.id,
      name: plan.name,
      updatedAt: plan.updatedAt ? new Date(plan.updatedAt).toISOString() : null,
    },
    environmentId: overrides.environmentId ?? null,
    browsers: {
      requested: overrides.browsers ?? null,
      testMachines: parsedJson(plan.testMachinesConfig),
    },
    selectedTests: selectedTests.map((test) => ({
      testType: test.testType,
      testId: test.testType === 'ui' ? test.testId : null,
      apiTestId: test.testType === 'api' ? test.apiTestId : null,
      ...(test.testType === 'mobile' ? { mobileTestId: test.mobileTestId ?? null } : {}),
    })),
    visualTesting: {
      enabled: plan.visualTestingEnabled === true,
      updateBaselines: overrides.updateBaselines === true,
    },
    evidence: {
      video: evidenceMode(plan.captureVideo),
      trace: evidenceMode(plan.captureTrace),
      network: evidenceMode(plan.captureNetwork),
    },
    maxParallelTests: plan.maxParallelTests ?? 1,
    shards: plan.shards ?? 1,
    workerLossPolicy: plan.workerLossPolicy === 'replay' ? 'replay' : 'indeterminate',
    captureScreenshots: plan.captureScreenshots ?? 'on_failed_steps',
    timeouts: {
      pageLoadMs: plan.pageLoadTimeout ?? 30_000,
      elementMs: plan.elementTimeout ?? 30_000,
    },
    failurePolicies: {
      onMajorStepFailure: plan.onMajorStepFailure ?? 'abort_and_run_next_test_case',
      onAbortedTestCase: plan.onAbortedTestCase ?? 'delete_cookies_and_reuse_session',
      onTestSuitePreRequisiteFailure: plan.onTestSuitePreRequisiteFailure ?? 'stop_execution',
      onTestCasePreRequisiteFailure: plan.onTestCasePreRequisiteFailure ?? 'stop_execution',
      onTestStepPreRequisiteFailure:
        plan.onTestStepPreRequisiteFailure ?? 'abort_and_run_next_test_case',
    },
    rerunPolicy: plan.reRunOnFailure ?? 'none',
    notificationSettings: parsedJson(plan.notificationSettings),
    issues: {
      trackerId: plan.issueTrackerId ?? null,
      createOnFailure: plan.createIssuesOnFailure === true,
    },
    runOn: { agentPool: plan.agentPool ?? null, browserGridId: plan.browserGridId ?? null },
    locales: normalizeLocales(parsedJson(plan.locales)),
    testManagement: { connectionId: plan.testManagementId ?? null },
  };
}

/**
 * What a run's stored configuration is.
 *
 * `legacy`: null or '{}' — every run queued before snapshots — which the worker may still build
 * from the plan, as such runs always were. `corrupt` (unparseable, not an object, a known
 * version with parts missing) and `unsupported` (a version this code does not know) are not
 * legacy: running them from the live plan would execute something nobody queued, so the worker
 * refuses them (R1, C04).
 */
export type SnapshotRead =
  | { kind: 'ok'; snapshot: ExecutionSnapshot }
  | { kind: 'legacy' }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'unsupported'; version: unknown };

export function inspectExecutionSnapshot(value: unknown): SnapshotRead {
  if (value === null || value === undefined) return { kind: 'legacy' };
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { kind: 'corrupt', reason: 'The stored configuration is not valid JSON.' };
    }
  }
  if (parsed === null) return { kind: 'legacy' };
  if (typeof parsed !== 'object' || Array.isArray(parsed))
    return { kind: 'corrupt', reason: 'The stored configuration is not an object.' };
  const candidate = parsed as Partial<ExecutionSnapshot>;
  if (Object.keys(candidate).length === 0) return { kind: 'legacy' };
  if (!('version' in candidate))
    return { kind: 'corrupt', reason: 'The stored configuration has no version.' };
  if (candidate.version !== EXECUTION_SNAPSHOT_VERSION)
    return { kind: 'unsupported', version: candidate.version };
  if (!Array.isArray(candidate.selectedTests) || !candidate.plan)
    return { kind: 'corrupt', reason: 'The stored configuration is incomplete.' };
  return { kind: 'ok', snapshot: candidate as ExecutionSnapshot };
}

/**
 * The snapshot a run carries, or null when it carries no usable one. For display and replay;
 * the worker uses inspectExecutionSnapshot, which says why.
 */
export function readExecutionSnapshot(value: unknown): ExecutionSnapshot | null {
  const read = inspectExecutionSnapshot(value);
  return read.kind === 'ok' ? read.snapshot : null;
}
