/**
 * The first phases of a run: somewhere to write, what it was asked to do, and the values its
 * `{{name}}` placeholders resolve to.
 */
import fs from 'fs-extra';
import { and, asc, eq } from 'drizzle-orm';
import {
  secrets as secretsTable,
  testPlans,
  testPlanSelectedTests,
  testPlanExecutions as testPlanExecutionsTable,
  type TestPlan,
  type TestPlanExecution,
} from '@shared/schema';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { transitionExecution } from '../execution-state';
import { reproducibilitySummary } from '../execution-provenance';
import {
  buildExecutionSnapshot,
  readExecutionSnapshot,
  type ExecutionSnapshot,
  type SnapshotTestReference,
} from '../execution-snapshot';
import { decryptSecret } from '../../platform/crypto';
import { defaultVariables } from '../../runtime/variables';
import { loadDataVariables } from '../../authoring/test-data';
import { ended, report, type Ended, type PlanRun } from './context';

/** Creates the run's results directory. A run that cannot write ends here, as an error. */
export async function ensureResultsDir(run: PlanRun): Promise<Ended | null> {
  try {
    await fs.ensureDir(run.resultsDir);
    return null;
  } catch (dirError: unknown) {
    const message = `Failed to create results directory: ${(dirError as Error).message}`;
    run.logger.error({
      message: 'Failed to create base results directory',
      baseResultsDir: run.resultsDir,
      error: (dirError as Error).message,
    });
    // A helper that cannot write leaves the run to the others.
    if (run.helper) return ended({ error: message, testPlanRunId: run.executionId });
    await transitionExecution(run.executionId, 'error', {
      failureCode: 'results_directory_unavailable',
      failureMessage: message,
      results: JSON.stringify([{ error: message }]),
      executionDurationMs: Date.now() - run.startedAt,
    });
    return ended({ error: message, status: 500, testPlanRunId: run.executionId });
  }
}

/** The execution row, and the configuration the run executes with. */
export interface RunInputs {
  execution: TestPlanExecution;
  organizationId: number;
  snapshot: ExecutionSnapshot;
}

export async function resolveInputs(run: PlanRun): Promise<RunInputs | Ended> {
  const [execution] = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(testPlanExecutionsTable)
      .where(eq(testPlanExecutionsTable.id, run.executionId))
      .limit(1),
  );
  if (!execution) {
    run.logger.error({
      message: 'Test plan execution record not found after creation',
      testPlanRunId: run.executionId,
    });
    return ended({
      error: `Test plan execution ${run.executionId} not found.`,
      status: 500,
      testPlanRunId: run.executionId,
    });
  }
  // What this run was asked to do, as it was asked. Everything below reads it and not the plan,
  // so a plan edited while the run waited does not change what the run does.
  const snapshot = await snapshotForRun(run.planId, execution, run.options);
  if (snapshot.definitions && !reproducibilitySummary(snapshot).available)
    throw new Error(
      'The queued execution inputs are incomplete or their fingerprints do not match.',
    );
  return { execution, organizationId: execution.organizationId, snapshot };
}

/**
 * The configuration this run executes with.
 *
 * The one it was queued with, when it has one. A run without — every run queued before snapshots
 * existed, and scheduled runs until the scheduler enqueues through the orchestrator — gets the
 * plan as it is now, with the row's own environment and browsers over it, which is exactly what
 * such runs always did. A plan deleted in the meantime leaves a snapshot with no tests, and the
 * run ends saying it found none, as it did before.
 */
async function snapshotForRun(
  planId: string,
  execution: TestPlanExecution,
  jobOptions: { updateBaselines?: boolean },
): Promise<ExecutionSnapshot> {
  const stored = readExecutionSnapshot(execution.configurationSnapshot);
  if (stored) return stored;

  const [plan] = await withTenantTransaction((tx) =>
    tx.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1),
  );
  const selected = plan
    ? await withTenantTransaction((tx) =>
        tx
          .select({
            testType: testPlanSelectedTests.testType,
            testId: testPlanSelectedTests.testId,
            apiTestId: testPlanSelectedTests.apiTestId,
            mobileTestId: testPlanSelectedTests.mobileTestId,
          })
          .from(testPlanSelectedTests)
          .where(eq(testPlanSelectedTests.testPlanId, planId))
          .orderBy(asc(testPlanSelectedTests.id)),
      )
    : [];
  const environmentId = execution.environment ? parseInt(execution.environment, 10) : NaN;

  return buildExecutionSnapshot(
    plan ?? ({ id: planId, name: planId } as TestPlan),
    selected as SnapshotTestReference[],
    {
      environmentId: Number.isNaN(environmentId) ? null : environmentId,
      browsers: execution.browsers,
      updateBaselines: jobOptions.updateBaselines,
    },
  );
}

/** What the run's `{{name}}` placeholders resolve to, and the environment that supplies them. */
export interface RunVariables {
  /** The environment's decrypted secrets. */
  secrets: Record<string, string>;
  /** Everything a test sees, with what earlier tests of its pass captured on top. */
  forPass(captured: Record<string, string>): Record<string, string>;
  /**
   * The same environment supplies the variables and the saved login, so a scheduled run
   * cannot resolve one site's secrets while reusing another site's session.
   */
  environment: { environmentId: number; organizationId: number } | undefined;
}

export async function loadVariables(run: PlanRun, inputs: RunInputs): Promise<RunVariables> {
  const { snapshot, organizationId } = inputs;
  const environmentId = snapshot.environmentId;
  const secrets: Record<string, string> = {};
  // The organization's shared test data, as {{data.<set>.<column>}} (shared/test-data.ts).
  const dataVariables: Record<string, string> = snapshot.datasets
    ? snapshot.datasets.variables
    : await withTenantTransaction((tx) => loadDataVariables(tx));
  const environment =
    environmentId && !isNaN(environmentId) ? { environmentId, organizationId } : undefined;

  if (environment) {
    // These values are decrypted and injected into the running test, and environmentId comes
    // off the execution row, which a caller can influence — so an id belonging to another
    // tenant would exfiltrate their secrets. RLS now bounds this to the job's organization;
    // the explicit organizationId predicate stays as the second lock.
    const environmentSecrets = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(secretsTable)
        .where(
          and(
            eq(secretsTable.environmentId, environment.environmentId),
            eq(secretsTable.organizationId, organizationId),
          ),
        ),
    );
    for (const secret of environmentSecrets) {
      try {
        secrets[secret.keyName] = await decryptSecret(
          secret.encryptedValue,
          secret.iv,
          secret.authTag,
          organizationId,
        );
      } catch {
        run.logger.warn(
          `Failed to decrypt secret ${secret.keyName} for environment ${environment.environmentId}`,
        );
      }
    }
    report(run, {
      level: 'info',
      message: `Loaded and decrypted ${Object.keys(secrets).length} secrets for environment ${environment.environmentId}`,
      metadata: {
        environmentId: environment.environmentId,
        secretCount: Object.keys(secrets).length,
      },
    });
  }

  return {
    secrets,
    // The defaults underneath, the environment's secrets on top — so an environment can
    // override `baseUrl` like any other name, and a run against site B does not depend on
    // what a process env var happened to hold.
    forPass: (captured) => ({
      ...defaultVariables(),
      ...dataVariables,
      ...secrets,
      // Values captured by tests that already ran in this pass. Last write wins, so a later
      // request can refresh a token an earlier one obtained.
      ...captured,
    }),
    environment,
  };
}
