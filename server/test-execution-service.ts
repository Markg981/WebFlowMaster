import { playwrightService } from './playwright-service';
import type { Test, ApiTest, TestPlanExecution, InsertReportTestCaseResult, Precondition } from '@shared/schema'; // Assuming ApiTest will be defined or Test is generic enough
import { runPreconditions } from './precondition-runner';
import type { StepResult } from './playwright-service'; // Import StepResult type
import loggerPromise from './logger';
import { privilegedDb } from './db';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import {
  tests as testsTable,
  apiTests as apiTestsTable,
  testPlanSelectedTests,
  testPlans,
  testPlanExecutions as testPlanExecutionsTable,
  reportTestCaseResults as reportTestCaseResultsTable // Added
} from '@shared/schema';
import { and, eq, inArray } from 'drizzle-orm'; // Added sql
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import { getWsEmitter, type ExecutionLogEntry } from './websocket';
import { testExecutionQueue } from './queue';
import { secrets as secretsTable } from '@shared/schema';
import { decryptSecret } from './crypto';
import { getCorrelationId } from './middleware/correlation';
import { defaultVariables } from './variables';

// Helper to interpolate {{SECRET_KEY}} in strings
function interpolateSecrets(str: string, secretsMap: Record<string, string>): string {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (match, keyName) => {
    return secretsMap[keyName] !== undefined ? secretsMap[keyName] : match;
  });
}

// Deep clone and inject secrets into a test object
function injectSecretsIntoTest(testObj: any, secretsMap: Record<string, string>): any {
  if (testObj === null || typeof testObj !== 'object') {
    return typeof testObj === 'string' ? interpolateSecrets(testObj, secretsMap) : testObj;
  }

  if (Array.isArray(testObj)) {
    return testObj.map(item => injectSecretsIntoTest(item, secretsMap));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(testObj)) {
    result[key] = injectSecretsIntoTest(value, secretsMap);
  }
  return result;
}

// Define a common result structure for individual test runs
export interface IndividualTestRunResult {
  testId: number;
  testType: 'ui' | 'api';
  name: string;
  success: boolean;
  status: 'passed' | 'failed' | 'error'; // Add 'error' for execution errors before steps
  steps?: StepResult[]; // from playwright-service
  error?: string; // For errors during test execution itself (e.g., Playwright internal error)
  durationMs: number;
  screenshotPath?: string; // General screenshot for API tests if applicable, or last step for UI
}


export async function runTest(
  test: Test | ApiTest, // Test is from shared/schema, ApiTest would also be from there
  userId: number,
  planId: string,
  runId: string, // This is the testPlanRun.id
  testType: 'ui' | 'api',
  // Resolved `{{name}}` values for this run's environment. One resolution feeds both the
  // preconditions and the step executor, so a placeholder cannot mean two different things
  // depending on which of them reads it.
  vars: Record<string, string> = defaultVariables(),
  // The environment whose saved browser session to start from, when it has one.
  environment?: { environmentId: number; organizationId: number },
): Promise<IndividualTestRunResult> {
  const resolvedLogger = await loggerPromise;
  const startTime = Date.now();
  const testId = test.id;
  const testName = test.name;

  resolvedLogger.info({ message: `Starting ${testType} test execution`, testId, testName, planId, runId, userId });

  if (testType === 'ui') {
    const uiTest = test as Test;
    const screenshotBaseDir = path.join('./results', planId, runId, `ui_${testId}`);
    try {
      await fs.ensureDir(screenshotBaseDir);

      // Establish preconditions (ordered API setup calls) before the UI sequence, so the
      // system under test is in the required state. Fail-fast: if setup fails, the test
      // is blocked (reported as 'error'), not a misleading pass/fail.
      const preResult = await runPreconditions(
        (uiTest as unknown as { preconditions?: Precondition[] | null }).preconditions,
        vars,
      );
      if (!preResult.ok) {
        const durationMs = Date.now() - startTime;
        resolvedLogger.warn({
          message: 'UI Test blocked: precondition failed',
          testId, testName, planId, runId, failedAt: preResult.failedAt, reason: preResult.reason,
        });
        return {
          testId,
          testType: 'ui',
          name: uiTest.name,
          success: false,
          status: 'error',
          error: `Precondition failed at "${preResult.failedAt}": ${preResult.reason}`,
          durationMs,
        };
      }

      const result = await playwrightService.executeTestSequence(uiTest, userId, screenshotBaseDir, runId, vars, environment);
      const durationMs = Date.now() - startTime;

      // Determine overall test status
      let finalStatus: 'passed' | 'failed' = 'passed';
      if (!result.success) {
        finalStatus = 'failed';
      } else if (result.steps?.some(step => step.status === 'failed')) {
        finalStatus = 'failed';
      }

      // Find the last screenshot taken, if any (especially on failure)
      let lastScreenshotPath: string | undefined;
      if (result.steps && result.steps.length > 0) {
        for (let i = result.steps.length - 1; i >= 0; i--) {
          if (result.steps[i].screenshot && typeof result.steps[i].screenshot === 'string' && !result.steps[i].screenshot!.startsWith('data:image')) {
            lastScreenshotPath = result.steps[i].screenshot;
            break;
          }
        }
      }


      resolvedLogger.info({ message: `UI Test completed`, testId, testName, planId, runId, success: result.success, durationMs });
      return {
        testId,
        testType: 'ui',
        name: uiTest.name,
        success: result.success,
        status: finalStatus,
        steps: result.steps,
        error: result.error,
        durationMs,
        screenshotPath: lastScreenshotPath, // Or a specific error screenshot for the whole test
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      resolvedLogger.error({ message: `Critical error during UI test execution`, testId, testName, planId, runId, error: error.message, stack: error.stack });
      return {
        testId,
        testType: 'ui',
        name: uiTest.name,
        success: false,
        status: 'error',
        error: `Execution failed: ${error.message}`,
        durationMs,
      };
    }
  } else if (testType === 'api') {
    const apiTest = test as ApiTest; // Cast to ApiTest
    resolvedLogger.info({ message: `API Test execution starting`, testId: apiTest.id, testName: apiTest.name, planId, runId });
    // Placeholder for API test execution logic
    // This should be implemented based on how API tests are defined and run.
    // For now, we'll simulate a simple execution.
    // Potentially reuse logic from `server/routes.ts` proxyApiRequest or a dedicated service method.

    // TODO: Implement actual API test execution logic here.
    // Example:
    // const apiExecutionResult = await executeApiTestInternal(apiTest, userId);
    // For now, simulate a pass/fail
    const success = Math.random() > 0.2; // Simulate 80% pass rate
    const durationMs = Math.floor(Math.random() * 1000) + 200; // Simulate duration

    resolvedLogger.info({ message: `API Test completed`, testId: apiTest.id, testName: apiTest.name, planId, runId, success, durationMs });
    return {
      testId: apiTest.id,
      testType: 'api',
      name: apiTest.name,
      success: success,
      status: success ? 'passed' : 'failed',
      error: success ? undefined : 'Simulated API test failure',
      durationMs,
      // API tests might not have steps or screenshots in the same way UI tests do,
      // but could have request/response logs or assertion results.
      // The `results` field in `testPlanRuns` can store this detailed JSON.
    };
  } else {
    const durationMs = Date.now() - startTime;
    resolvedLogger.error({ message: "Unknown test type provided to runTest", testType, testId, planId, runId });
    return {
      testId,
      testType: testType, // Echo back the unknown type
      name: testName,
      success: false,
      status: 'error',
      error: `Unknown test type: ${testType}`,
      durationMs,
    };
  }
}
// runTestPlan will be added here later
// Placeholder for executeApiTestInternal - this would need full implementation
// async function executeApiTestInternal(apiTest: ApiTest, userId: number) {
//   // Fetch API, execute, run assertions, etc.
//   // Similar to the logic in POST /api/proxy-api-request in routes.ts
//   return { success: true, details: { statusCode: 200, responseBody: { message: "ok"} } };
// }

export async function runTestPlan(
  planId: string,
  userId: number,
  environmentId?: number
): Promise<TestPlanExecution | { error: string; status?: number; testPlanRunId?: string }> {
  const resolvedLogger = await loggerPromise;
  const testPlanRunId = uuidv4();
  const overallStartTime = Date.now();

  resolvedLogger.info({ message: `Enqueueing test plan execution`, planId, testPlanRunId, userId });

  // The other tenant-context boundary, alongside processTestPlanJob's. This is called both
  // from a route (which has an ambient organization and has already checked the caller owns
  // this plan) and from the scheduler (which has neither), so the lookup that establishes the
  // organization runs privileged in both cases and the insert below is stamped from it.
  const planResult = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1);
  if (!planResult || planResult.length === 0) {
    resolvedLogger.error({ message: `Test Plan not found`, planId, testPlanRunId });
    return { error: 'Test Plan not found', status: 404 };
  }

  let currentTestPlanRun: TestPlanExecution;
  try {
    const inserted = await privilegedDb.insert(testPlanExecutionsTable)
      .values({
        id: testPlanRunId,
        // Same organization as the plan being run.
        organizationId: planResult[0].organizationId,
        testPlanId: planId,
        status: 'pending', // Queue status
        startedAt: new Date(overallStartTime),
        environment: environmentId ? environmentId.toString() : null, // Save environment ID here
        triggeredBy: 'manual',
      })
      .returning();
    currentTestPlanRun = inserted[0];

    // Add job to Queue
    await testExecutionQueue.add('execute-plan', {
      planId,
      testPlanRunId,
      userId,
      correlationId: getCorrelationId() || `job-${testPlanRunId.slice(0, 8)}`
    });

    resolvedLogger.info({ message: 'TestPlanRun job enqueued successfully', testPlanRunId, dbId: currentTestPlanRun.id });
    return currentTestPlanRun;
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'Failed to enqueue test plan run', planId, testPlanRunId, error: dbError.message, stack: dbError.stack });
    return { error: `Failed to initialize test plan run: ${dbError.message}`, status: 500 };
  }
}

/**
 * Establishes the tenant context for a queue job, then runs it.
 *
 * A BullMQ worker has no Express request, so `tenancyMiddleware` never ran and there is no
 * ambient organization to inherit. Exactly one lookup therefore has to run privileged — the
 * one that answers "which organization is this job for?" — and everything after it runs under
 * that organization's RLS binding. This function is that boundary, and it is the only place in
 * the execution path that reaches an org-scoped table outside the tenant context.
 *
 * Deliberately NOT one long transaction around the whole job: a plan execution drives a real
 * browser for minutes, and holding a pooled connection open for its duration would starve the
 * pool. `runWithTenant` establishes the ambient organization; each query inside opens its own
 * short `withTenantTransaction`.
 */
export async function processTestPlanJob(
  planId: string,
  testPlanRunId: string,
  userId: number
): Promise<any> {
  const bootstrapLogger = await loggerPromise;
  const [execution] = await privilegedDb
    .select({ organizationId: testPlanExecutionsTable.organizationId })
    .from(testPlanExecutionsTable)
    .where(eq(testPlanExecutionsTable.id, testPlanRunId))
    .limit(1);

  if (!execution) {
    bootstrapLogger.error({ message: 'Test plan execution record not found', testPlanRunId });
    return { error: `Test plan execution ${testPlanRunId} not found.`, status: 500, testPlanRunId };
  }

  return runWithTenant(execution.organizationId, () =>
    runTestPlanJobInTenant(planId, testPlanRunId, userId),
  );
}

async function runTestPlanJobInTenant(
  planId: string,
  testPlanRunId: string,
  userId: number
): Promise<any> {
  const resolvedLogger = await loggerPromise;
  const wsEmitter = getWsEmitter();
  const overallStartTime = Date.now();

  const startLog: ExecutionLogEntry = {
    level: 'info',
    source: 'system',
    message: `Starting background test plan execution for plan ${planId}`,
    timestamp: new Date(overallStartTime).toISOString(),
    metadata: { planId, testPlanRunId, userId }
  };
  resolvedLogger.info(startLog);
  wsEmitter.emitExecutionLog(testPlanRunId, startLog);

  // Update status to running
  await withTenantTransaction(async (tx) => {
    await tx.update(testPlanExecutionsTable)
      .set({ status: 'running' })
      .where(eq(testPlanExecutionsTable.id, testPlanRunId));
  });

  const currentTestPlanRun: any = { startedAt: Math.floor(overallStartTime / 1000) };

  const baseResultsDir = path.join('./results', planId, testPlanRunId);
  try {
    await fs.ensureDir(baseResultsDir);
  } catch (dirError: any) {
    resolvedLogger.error({ message: 'Failed to create base results directory', baseResultsDir, error: dirError.message });
    await withTenantTransaction(async (tx) => {
      await tx.update(testPlanExecutionsTable).set({
        status: 'error',
        completedAt: new Date(),
        results: JSON.stringify([{ error: `Failed to create results directory: ${dirError.message}` }]),
        executionDurationMs: Date.now() - overallStartTime,
      }).where(eq(testPlanExecutionsTable.id, testPlanRunId));
    });
    return { error: `Failed to create results directory: ${dirError.message}`, status: 500, testPlanRunId };
  }

  // Phase 8: Fetch Environment and Secrets
  const executionRecord = await withTenantTransaction((tx) =>
    tx.select().from(testPlanExecutionsTable).where(eq(testPlanExecutionsTable.id, testPlanRunId)).limit(1),
  );
  if (executionRecord.length === 0) {
    resolvedLogger.error({ message: 'Test plan execution record not found after creation', testPlanRunId });
    return { error: `Test plan execution ${testPlanRunId} not found.`, status: 500, testPlanRunId };
  }
  const environmentId = executionRecord[0].environment ? parseInt(executionRecord[0].environment) : null;
  const secretsMap: Record<string, string> = {};
  // The defaults underneath, the environment's secrets on top — so an environment can
  // override `baseUrl` like any other name, and a run against site B does not depend on
  // what a process env var happened to hold.
  const runVariables = (): Record<string, string> => ({ ...defaultVariables(), ...secretsMap });
  // The same environment supplies the variables and the saved login, so a scheduled run
  // cannot resolve one site's secrets while reusing another site's session.
  const planEnvironment = () =>
    environmentId && !isNaN(environmentId)
      ? { environmentId, organizationId: executionRecord[0].organizationId }
      : undefined;

  if (environmentId && !isNaN(environmentId)) {
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
            eq(secretsTable.environmentId, environmentId),
            eq(secretsTable.organizationId, executionRecord[0].organizationId),
          ),
        ),
    );
    for (const secret of environmentSecrets) {
      try {
        secretsMap[secret.keyName] = decryptSecret(secret.encryptedValue, secret.iv, secret.authTag);
      } catch (e) {
        resolvedLogger.warn(`Failed to decrypt secret ${secret.keyName} for environment ${environmentId}`);
      }
    }
    const envLog: ExecutionLogEntry = {
      level: 'info',
      source: 'system',
      message: `Loaded and decrypted ${Object.keys(secretsMap).length} secrets for environment ${environmentId}`,
      timestamp: new Date().toISOString(),
      metadata: { environmentId, secretCount: Object.keys(secretsMap).length }
    };
    resolvedLogger.info(envLog);
    wsEmitter.emitExecutionLog(testPlanRunId, envLog);
  }

  const selectedTestsLinks = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, planId)),
  );

  wsEmitter.emitExecutionLog(testPlanRunId, {
    level: 'info',
    source: 'system',
    message: `Found ${selectedTestsLinks.length} tests to execute in this plan.`,
    timestamp: new Date().toISOString()
  });

  // ⚡ BOLT OPTIMIZATION: Resolve N+1 query problem by batch-fetching all required
  // UI and API test definitions in a single database roundtrip.
  // Using Map for O(1) in-memory lookups during the sequential execution loop.
  // This significantly reduces DB load and latency for plans with many tests.
  const uiTestIds = selectedTestsLinks.filter(l => l.testType === 'ui' && l.testId).map(l => l.testId as number);
  const apiTestIds = selectedTestsLinks.filter(l => l.testType === 'api' && l.apiTestId).map(l => l.apiTestId as number);

  const uiTestsMap = new Map<number, Test>();
  if (uiTestIds.length > 0) {
    // No organization predicate: RLS supplies it. These ids come from the join rows above, and
    // the create/update handlers validate them against the caller's organization, but this is
    // the query that used to make an unvalidated foreign id executable.
    const uiTests = await withTenantTransaction((tx) =>
      tx.select().from(testsTable).where(inArray(testsTable.id, uiTestIds)),
    );
    uiTests.forEach(t => uiTestsMap.set(t.id, t as Test));
  }

  const apiTestsMap = new Map<number, ApiTest>();
  if (apiTestIds.length > 0) {
    const apiTests = await withTenantTransaction((tx) =>
      tx.select().from(apiTestsTable).where(inArray(apiTestsTable.id, apiTestIds)),
    );
    apiTests.forEach(t => apiTestsMap.set(t.id, t as ApiTest));
  }

  const legacyIndividualTestResultsForJsonBlob: IndividualTestRunResult[] = [];

  for (const link of selectedTestsLinks) {
    let testObjectDefinition: Test | ApiTest | undefined;
    const testTypeForRun: 'ui' | 'api' | undefined = link.testType as ('ui' | 'api');

    if (link.testId && link.testType === 'ui') {
      testObjectDefinition = uiTestsMap.get(link.testId);
    } else if (link.apiTestId && link.testType === 'api') {
      testObjectDefinition = apiTestsMap.get(link.apiTestId);
    }

    const singleTestStartTime = Date.now();
    let reportStatus: InsertReportTestCaseResult['status'] = 'Pending'; // Default
    let failureReason: string | undefined = undefined;
    let screenshotFinalPath: string | undefined = undefined;
    let stepsOrLogData: string | undefined = undefined;

    const testName = testObjectDefinition?.name || `Unknown Test (ID: ${link.testId || link.apiTestId})`;
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: `Starting test: ${testName} (${testTypeForRun})`,
      timestamp: new Date(singleTestStartTime).toISOString(),
      metadata: { testId: link.testId || link.apiTestId, testType: testTypeForRun }
    });

    if (testObjectDefinition && testTypeForRun) {
      if (testTypeForRun === 'ui' && typeof (testObjectDefinition as Test).sequence === 'string') {
        try { (testObjectDefinition as Test).sequence = JSON.parse((testObjectDefinition as Test).sequence as any); }
        catch (e) { resolvedLogger.warn("Failed to parse UI test sequence"); }
      }
      if (testTypeForRun === 'ui' && typeof (testObjectDefinition as Test).elements === 'string') {
        try { (testObjectDefinition as Test).elements = JSON.parse((testObjectDefinition as Test).elements as any); }
        catch (e) { resolvedLogger.warn("Failed to parse UI test elements"); }
      }

      // API tests still have their `{{KEY}}` placeholders substituted into the request
      // object up front: the API runner has no per-field resolution step to hand a variable
      // map to. UI tests no longer need it — the shared step executor resolves them from the
      // same map — and doing both would hide an unresolved name instead of reporting it.
      if (testTypeForRun === 'api' && Object.keys(secretsMap).length > 0) {
        testObjectDefinition = injectSecretsIntoTest(testObjectDefinition, secretsMap);
      }

      const resultFromRunTest = await runTest(
        testObjectDefinition!,
        userId,
        planId,
        testPlanRunId,
        testTypeForRun,
        runVariables(),
        planEnvironment(),
      );
      legacyIndividualTestResultsForJsonBlob.push(resultFromRunTest); // Keep populating the old JSON blob for now

      // Map runTest result to reportTestCaseResults status
      if (resultFromRunTest.status === 'passed') reportStatus = 'Passed';
      else if (resultFromRunTest.status === 'failed') reportStatus = 'Failed';
      else if (resultFromRunTest.status === 'error') reportStatus = 'Error';
      // 'Skipped' needs to be handled if runTest can produce it

      failureReason = resultFromRunTest.error;
      screenshotFinalPath = resultFromRunTest.screenshotPath; // This is a file path
      stepsOrLogData = resultFromRunTest.steps ? JSON.stringify(resultFromRunTest.steps) : undefined; // For UI tests

      const singleTestDurationMs = Date.now() - singleTestStartTime;
      wsEmitter.emitExecutionLog(testPlanRunId, {
        level: reportStatus === 'Passed' ? 'info' : 'error',
        source: 'system',
        message: `Finished test: ${testName}. Status: ${reportStatus} (${singleTestDurationMs}ms)`,
        timestamp: new Date().toISOString(),
        metadata: { durationMs: singleTestDurationMs, status: reportStatus }
      });

      // Convert screenshotPath to a URL if needed, e.g., /results/planId/runId/testId/screenshot.png
      if (screenshotFinalPath) {
        // Assuming 'results' is served statically at /results
        screenshotFinalPath = screenshotFinalPath.replace(/^\.?\/?results/, '/results').replace(/\\/g, '/');
      }


    } else {
      resolvedLogger.warn({ message: `Test object not found or type mismatch for link`, linkId: link.id });
      reportStatus = 'Error';
      failureReason = 'Test definition not found or type mismatch during plan execution.';
      legacyIndividualTestResultsForJsonBlob.push({
        testId: link.testId || link.apiTestId || -1,
        testType: (link.testType as 'ui' | 'api' || 'unknown') as 'ui' | 'api',
        name: `Unknown Test (ID: ${link.testId || link.apiTestId})`,
        success: false, status: 'error', error: failureReason, durationMs: 0,
      });
    }

    const singleTestEndTime = Date.now();
    const singleTestDurationMs = singleTestEndTime - singleTestStartTime;

    const reportCaseResultId = uuidv4();
    const newReportEntry: InsertReportTestCaseResult = {
      id: reportCaseResultId,
      // Same organization as the test plan execution this result belongs to.
      organizationId: executionRecord[0].organizationId,
      testPlanExecutionId: testPlanRunId,
      uiTestId: link.testType === 'ui' ? link.testId : null,
      apiTestId: link.testType === 'api' ? link.apiTestId : null,
      testType: link.testType as 'ui' | 'api',
      testName: testObjectDefinition?.name || `Unknown Test (ID: ${link.testId || link.apiTestId})`,
      status: reportStatus,
      reasonForFailure: failureReason,
      screenshotUrl: screenshotFinalPath,
      detailedLog: stepsOrLogData, // Or specific log for API tests
      startedAt: new Date(singleTestStartTime),
      completedAt: new Date(singleTestEndTime),
      durationMs: singleTestDurationMs,
      module: testObjectDefinition?.module || null,
      featureArea: testObjectDefinition?.featureArea || null,
      scenario: testObjectDefinition?.scenario || null,
      component: testObjectDefinition?.component || null,
      priority: testObjectDefinition?.priority || null,
      severity: testObjectDefinition?.severity || null, // This is designed severity. Runtime severity could differ.
    };

    try {
      await withTenantTransaction((tx) => tx.insert(reportTestCaseResultsTable).values(newReportEntry));
    } catch (dbInsertError: any) {
      resolvedLogger.error({ message: 'Failed to insert into reportTestCaseResultsTable', entry: newReportEntry, error: dbInsertError.message });
      // Continue execution, this test result might be missing from detailed report but plan will complete.
    }
  } // End of loop for selectedTestsLinks

  // After all tests have run, calculate final aggregates from reportTestCaseResultsTable
  const finalDetailedResults = await withTenantTransaction((tx) =>
    tx.select()
      .from(reportTestCaseResultsTable)
      .where(eq(reportTestCaseResultsTable.testPlanExecutionId, testPlanRunId)),
  );

  const calculatedTotalTests = finalDetailedResults.length;
  const calculatedPassedTests = finalDetailedResults.filter((r: any) => r.status === 'Passed').length;
  const calculatedFailedTests = finalDetailedResults.filter((r: any) => r.status === 'Failed').length;
  const calculatedSkippedTests = finalDetailedResults.filter((r: any) => r.status === 'Skipped').length;
  // Consider 'Error' status as failures or a separate category if needed for overall status.
  // For overall status, let's say if any 'Failed' or 'Error', the whole run is 'failed'.
  // If any 'Skipped' and no 'Failed'/'Error', maybe 'partial' or 'completed_with_skipped'.
  // If all 'Passed', then 'completed'.

  let finalOverallStatus: TestPlanExecution['status'] = 'pending'; // Should be 'completed' or 'failed' or 'error'
  if (calculatedTotalTests === 0 && selectedTestsLinks.length > 0) {
    finalOverallStatus = 'error'; // No results recorded but tests were expected
  } else if (calculatedFailedTests > 0 || finalDetailedResults.some((r: any) => r.status === 'Error')) {
    finalOverallStatus = 'failed';
  } else if (calculatedTotalTests === calculatedPassedTests && calculatedTotalTests > 0) {
    finalOverallStatus = 'completed';
  } else if (calculatedTotalTests > 0 && calculatedPassedTests < calculatedTotalTests) {
    // Some tests ran, none failed outright, but not all passed (e.g. skipped, or if we add other non-failure statuses)
    finalOverallStatus = 'completed'; // Or a more nuanced status like 'completed_with_issues'
  } else if (selectedTestsLinks.length === 0) {
    finalOverallStatus = 'completed'; // No tests to run, so it's 'completed'
  } else {
    finalOverallStatus = 'error'; // Default to error if logic doesn't cover a state
  }


  const overallCompletedAt = Date.now();
  const overallExecutionDurationMs = overallCompletedAt - overallStartTime;

  try {
    const finalUpdateResult = await withTenantTransaction((tx) =>
      tx.update(testPlanExecutionsTable)
        .set({
          status: finalOverallStatus,
          results: JSON.stringify(legacyIndividualTestResultsForJsonBlob), // Keep the old JSON blob for now
          completedAt: new Date(overallCompletedAt),
          totalTests: calculatedTotalTests,
          passedTests: calculatedPassedTests,
          failedTests: calculatedFailedTests,
          skippedTests: calculatedSkippedTests,
          executionDurationMs: overallExecutionDurationMs,
        })
        .where(eq(testPlanExecutionsTable.id, testPlanRunId))
        .returning(),
    );

    if (finalUpdateResult.length > 0) {
      resolvedLogger.info({ message: `Test plan execution COMPLETED and DB updated`, planId, testPlanRunId, overallStatus: finalOverallStatus, testsRun: calculatedTotalTests });
      return finalUpdateResult[0];
    } else {
      // This should not happen if the initial insert succeeded.
      resolvedLogger.error({ message: `Failed to perform FINAL update on TestPlanRun DB record`, planId, testPlanRunId });
      currentTestPlanRun.status = 'error'; // Update in-memory object
      return { ...currentTestPlanRun, error: "Failed to finalize database record, but execution attempted." } as any; // Cast to avoid type issues with error prop
    }
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'CRITICAL: Failed to update TestPlanRun with final aggregates in DB', planId, testPlanRunId, error: dbError.message });
    return {
      id: testPlanRunId, testPlanId: planId, status: 'error',
      results: JSON.stringify(legacyIndividualTestResultsForJsonBlob),
      startedAt: currentTestPlanRun.startedAt,
      completedAt: new Date(overallCompletedAt),
      error: `DB error during final aggregate update: ${dbError.message}`
    } as any;
  }
}
