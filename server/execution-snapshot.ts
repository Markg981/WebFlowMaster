import { EVIDENCE_CAPTURE_MODES, type EvidenceCaptureMode, type TestPlan } from '@shared/schema';

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
  testType: 'ui' | 'api';
  testId: number | null;
  apiTestId: number | null;
}

export interface ExecutionSnapshot {
  version: typeof EXECUTION_SNAPSHOT_VERSION;
  capturedAt: string;
  plan: { id: string; name: string; updatedAt: string | null };
  environmentId: number | null;
  /**
   * The two sources the browser matrix is derived from, kept as they were rather than resolved:
   * the worker resolves them with server/browsers.ts, so which browsers exist on the runner is
   * decided where the browsers are, and the request still cannot be changed after the fact.
   */
  browsers: { requested: unknown; testMachines: unknown };
  /** In plan order, fixed at enqueue: a test added to the plan later is not in this run. */
  selectedTests: SnapshotTestReference[];
  visualTesting: { enabled: boolean; updateBaselines: boolean };
  evidence: { video: EvidenceCaptureMode; trace: EvidenceCaptureMode };
  maxParallelTests: number;
  captureScreenshots: string;
  /** As the plan stored them; server/run-policies.ts reads them, units and all. */
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
    })),
    visualTesting: {
      enabled: plan.visualTestingEnabled === true,
      updateBaselines: overrides.updateBaselines === true,
    },
    evidence: { video: evidenceMode(plan.captureVideo), trace: evidenceMode(plan.captureTrace) },
    maxParallelTests: plan.maxParallelTests ?? 1,
    captureScreenshots: plan.captureScreenshots ?? 'on_failed_steps',
    timeouts: { pageLoadMs: plan.pageLoadTimeout ?? 30_000, elementMs: plan.elementTimeout ?? 30_000 },
    failurePolicies: {
      onMajorStepFailure: plan.onMajorStepFailure ?? 'abort_and_run_next_test_case',
      onAbortedTestCase: plan.onAbortedTestCase ?? 'delete_cookies_and_reuse_session',
      onTestSuitePreRequisiteFailure: plan.onTestSuitePreRequisiteFailure ?? 'stop_execution',
      onTestCasePreRequisiteFailure: plan.onTestCasePreRequisiteFailure ?? 'stop_execution',
      onTestStepPreRequisiteFailure: plan.onTestStepPreRequisiteFailure ?? 'abort_and_run_next_test_case',
    },
    rerunPolicy: plan.reRunOnFailure ?? 'none',
    notificationSettings: parsedJson(plan.notificationSettings),
    issues: { trackerId: plan.issueTrackerId ?? null, createOnFailure: plan.createIssuesOnFailure === true },
  };
}

/**
 * The snapshot a run carries, or null when it carries none.
 *
 * Null for '{}' — every row from before snapshots — and for a version this code does not know,
 * so a worker older than the snapshot it is handed reads the plan rather than half of a contract
 * it does not understand.
 */
export function readExecutionSnapshot(value: unknown): ExecutionSnapshot | null {
  const parsed = parsedJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidate = parsed as Partial<ExecutionSnapshot>;
  if (candidate.version !== EXECUTION_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(candidate.selectedTests) || !candidate.plan) return null;
  return candidate as ExecutionSnapshot;
}
