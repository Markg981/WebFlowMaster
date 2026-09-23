import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { testPlans, type TestPlan } from '@shared/schema';
import {
  EXECUTION_SNAPSHOT_VERSION,
  buildExecutionSnapshot,
  readExecutionSnapshot,
} from './execution-snapshot';

/**
 * The snapshot is only worth having if it holds everything the runner reads. One that misses a
 * setting does not fail loudly: the worker reads the missing value as its default and a feature
 * quietly stops working — which is exactly what the first attempt at snapshots would have done
 * to the browser matrix, parallelism, visual testing, evidence and issue filing.
 */

const plan: TestPlan = {
  id: 'plan-1',
  userId: 7,
  organizationId: 3,
  name: 'Checkout',
  description: 'Everything between the cart and the receipt',
  testMachinesConfig: [{ browser: 'firefox' }],
  captureScreenshots: 'always',
  captureVideo: 'on_failure',
  captureTrace: 'always',
  visualTestingEnabled: true,
  pageLoadTimeout: 45_000,
  elementTimeout: 12_000,
  onMajorStepFailure: 'stop_run',
  onAbortedTestCase: 'new_session',
  onTestSuitePreRequisiteFailure: 'continue',
  onTestCasePreRequisiteFailure: 'skip',
  onTestStepPreRequisiteFailure: 'stop_run',
  reRunOnFailure: 'once',
  maxParallelTests: 4,
  issueTrackerId: 'tracker-9',
  createIssuesOnFailure: true,
  notificationSettings: { email: { enabled: true, recipients: ['qa@example.test'] } },
  createdAt: new Date('2026-09-01T08:00:00Z'),
  updatedAt: new Date('2026-09-20T10:30:00Z'),
};

const now = new Date('2026-09-23T12:00:00Z');

describe('buildExecutionSnapshot', () => {
  it('holds every setting the runner reads, as the plan has it', () => {
    const snapshot = buildExecutionSnapshot(
      plan,
      [
        { testType: 'ui', testId: 11, apiTestId: null },
        { testType: 'api', testId: null, apiTestId: 22 },
      ],
      { environmentId: 5, browsers: ['webkit'], updateBaselines: true },
      now,
    );

    expect(snapshot).toEqual({
      version: EXECUTION_SNAPSHOT_VERSION,
      capturedAt: '2026-09-23T12:00:00.000Z',
      plan: { id: 'plan-1', name: 'Checkout', updatedAt: '2026-09-20T10:30:00.000Z' },
      environmentId: 5,
      browsers: { requested: ['webkit'], testMachines: [{ browser: 'firefox' }] },
      selectedTests: [
        { testType: 'ui', testId: 11, apiTestId: null },
        { testType: 'api', testId: null, apiTestId: 22 },
      ],
      visualTesting: { enabled: true, updateBaselines: true },
      evidence: { video: 'on_failure', trace: 'always' },
      maxParallelTests: 4,
      captureScreenshots: 'always',
      timeouts: { pageLoadMs: 45_000, elementMs: 12_000 },
      failurePolicies: {
        onMajorStepFailure: 'stop_run',
        onAbortedTestCase: 'new_session',
        onTestSuitePreRequisiteFailure: 'continue',
        onTestCasePreRequisiteFailure: 'skip',
        onTestStepPreRequisiteFailure: 'stop_run',
      },
      rerunPolicy: 'once',
      notificationSettings: { email: { enabled: true, recipients: ['qa@example.test'] } },
      issues: { trackerId: 'tracker-9', createOnFailure: true },
    });
  });

  it('fills what a request did not say from the plan, and what the plan left empty from the defaults', () => {
    const bare = {
      ...plan,
      testMachinesConfig: JSON.stringify([{ browser: 'chromium' }]),
      captureVideo: 'sometimes',
      visualTestingEnabled: null,
      pageLoadTimeout: null,
      elementTimeout: null,
      reRunOnFailure: null,
      issueTrackerId: null,
      createIssuesOnFailure: false,
      notificationSettings: null,
    } as unknown as TestPlan;

    const snapshot = buildExecutionSnapshot(bare, [], {}, now);

    expect(snapshot.environmentId).toBeNull();
    // Stored as text by some older writes; the snapshot holds what it means.
    expect(snapshot.browsers).toEqual({ requested: null, testMachines: [{ browser: 'chromium' }] });
    // A value the runner does not know records nothing rather than something it would guess.
    expect(snapshot.evidence.video).toBe('never');
    expect(snapshot.visualTesting).toEqual({ enabled: false, updateBaselines: false });
    expect(snapshot.timeouts).toEqual({ pageLoadMs: 30_000, elementMs: 30_000 });
    expect(snapshot.rerunPolicy).toBe('none');
    expect(snapshot.notificationSettings).toBeNull();
    expect(snapshot.issues).toEqual({ trackerId: null, createOnFailure: false });
  });

  it('keeps only the id that belongs to each test type', () => {
    const snapshot = buildExecutionSnapshot(plan, [{ testType: 'ui', testId: 11, apiTestId: 99 }], {}, now);
    expect(snapshot.selectedTests).toEqual([{ testType: 'ui', testId: 11, apiTestId: null }]);
  });

  /**
   * A new column on test_plans fails this until somebody decides whether the runner reads it.
   * If it does, it goes into the snapshot; if it does not, it goes on the list below with the
   * reason. Either way it is a decision, not an omission.
   */
  it('has decided, for every plan column, whether a run needs it', () => {
    const notForTheRunner: Record<string, string> = {
      id: 'recorded as plan.id',
      name: 'recorded as plan.name',
      updatedAt: 'recorded as plan.updatedAt, to tell which edit of the plan ran',
      userId: 'who owns the plan, not how it runs',
      organizationId: 'on the execution row itself',
      description: 'prose for people',
      createdAt: 'history, not configuration',
    };
    const captured = new Set([
      'testMachinesConfig',
      'captureScreenshots',
      'captureVideo',
      'captureTrace',
      'visualTestingEnabled',
      'pageLoadTimeout',
      'elementTimeout',
      'onMajorStepFailure',
      'onAbortedTestCase',
      'onTestSuitePreRequisiteFailure',
      'onTestCasePreRequisiteFailure',
      'onTestStepPreRequisiteFailure',
      'reRunOnFailure',
      'maxParallelTests',
      'issueTrackerId',
      'createIssuesOnFailure',
      'notificationSettings',
    ]);

    const undecided = Object.keys(getTableColumns(testPlans)).filter(
      (column) => !captured.has(column) && !(column in notForTheRunner),
    );
    expect(undecided, 'plan columns neither in the snapshot nor declared irrelevant to a run').toEqual([]);
  });
});

describe('readExecutionSnapshot', () => {
  it('reads back what was written, whether it arrives as an object or as text', () => {
    const snapshot = buildExecutionSnapshot(plan, [{ testType: 'ui', testId: 11, apiTestId: null }], {}, now);
    expect(readExecutionSnapshot(snapshot)).toEqual(snapshot);
    expect(readExecutionSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('says there is none for rows from before snapshots, and for a version it does not know', () => {
    expect(readExecutionSnapshot({})).toBeNull();
    expect(readExecutionSnapshot('{}')).toBeNull();
    expect(readExecutionSnapshot(null)).toBeNull();
    expect(readExecutionSnapshot([])).toBeNull();
    expect(readExecutionSnapshot('not json')).toBeNull();
    const snapshot = buildExecutionSnapshot(plan, [], {}, now);
    expect(readExecutionSnapshot({ ...snapshot, version: 2 })).toBeNull();
  });
});
