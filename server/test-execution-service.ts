import { playwrightService } from './playwright-service';
import type { Test, ApiTest, TestPlan } from '@shared/schema'; // Assuming ApiTest will be defined or Test is generic enough
import type { StepResult } from './playwright-service'; // Import StepResult type
import loggerPromise from './logger';
import { db } from './db';
import { tests as testsTable, apiTests as apiTestsTable, testPlanSelectedTests, testPlans, testPlanExecutions as testPlanExecutionsTable } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';

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
  testType: 'ui' | 'api'
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
      const result = await playwrightService.executeTestSequence(uiTest, userId, screenshotBaseDir);
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
  userId: number
): Promise<any> { // Replace 'any' with a proper TestPlanRun type from schema
  const resolvedLogger = await loggerPromise;
  const testPlanRunId = uuidv4(); // This is the unique ID for this specific run execution

  resolvedLogger.info({ message: `Starting test plan execution`, planId, testPlanRunId, userId });

  // 1. Fetch TestPlan details
  const plan = await db.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1);
  if (!plan || plan.length === 0) {
    resolvedLogger.error({ message: `Test Plan not found`, planId, testPlanRunId });
    // Should we create a TestPlanRun record with 'error' status?
    // For now, just return an error object. The route handler can decide.
    return { error: 'Test Plan not found', status: 404 };
  }
  const testPlan = plan[0];

  // 2. Create initial TestPlanRun record in DB
  let currentTestPlanRun;
  try {
    const inserted = await db.insert(testPlanExecutionsTable) // Assuming testPlanRunsTable is the imported schema object
      .values({
        id: testPlanRunId,
        testPlanId: planId,
        status: 'running',
        // startedAt will be set by the database default
        // `results` will be updated as tests complete
      })
      .returning();
    currentTestPlanRun = inserted[0];
     resolvedLogger.info({ message: 'Initial TestPlanRun record created', testPlanRunId, dbId: currentTestPlanRun.id });
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'Failed to create initial TestPlanRun record in DB', planId, testPlanRunId, error: dbError.message, stack: dbError.stack });
    return { error: `Failed to initialize test plan run: ${dbError.message}`, status: 500 };
  }

  // 3. Create base results directory
  const baseResultsDir = path.join('./results', planId, testPlanRunId);
  try {
    await fs.ensureDir(baseResultsDir);
    resolvedLogger.debug({ message: 'Base results directory ensured', baseResultsDir });
  } catch (dirError: any) {
    resolvedLogger.error({ message: 'Failed to create base results directory', baseResultsDir, error: dirError.message, stack: dirError.stack });
    // Update TestPlanRun to 'error' status
    await db.update(testPlanExecutionsTable).set({ status: 'error', completedAt: Math.floor(Date.now() / 1000) }).where(eq(testPlanExecutionsTable.id, testPlanRunId));
    return { error: `Failed to create results directory: ${dirError.message}`, status: 500, testPlanRunId };
  }

  // 4. Fetch associated tests (UI and API)
  const selectedTestsLinks = await db
    .select()
    .from(testPlanSelectedTests)
    .where(eq(testPlanSelectedTests.testPlanId, planId));

  const individualTestResults: IndividualTestRunResult[] = [];
  let overallStatus: 'passed' | 'failed' | 'partial' = 'passed'; // Assume passed until a failure

  for (const link of selectedTestsLinks) {
    let testObject: Test | ApiTest | undefined;
    let testTypeForRun: 'ui' | 'api' | undefined;

    if (link.testId && link.testType === 'ui') {
      const uiTestArr = await db.select().from(testsTable).where(eq(testsTable.id, link.testId)).limit(1);
      if (uiTestArr.length > 0) testObject = uiTestArr[0] as Test; // Drizzle returns JSON as string if not mode:'json'
      testTypeForRun = 'ui';
    } else if (link.apiTestId && link.testType === 'api') {
      const apiTestArr = await db.select().from(apiTestsTable).where(eq(apiTestsTable.id, link.apiTestId)).limit(1);
      if (apiTestArr.length > 0) testObject = apiTestArr[0] as ApiTest;
      testTypeForRun = 'api';
    }

    if (testObject && testTypeForRun) {
      // Before running the test, parse sequence/elements if they are strings (from older schema or direct DB read)
      if (testTypeForRun === 'ui' && typeof (testObject as Test).sequence === 'string') {
        try {
          (testObject as Test).sequence = JSON.parse((testObject as Test).sequence as any);
        } catch (e) {
          resolvedLogger.warn({ message: "Failed to parse UI test sequence from string", testId: testObject.id, sequence: (testObject as Test).sequence });
          // Potentially mark this specific test as an error and continue
        }
      }
      if (testTypeForRun === 'ui' && typeof (testObject as Test).elements === 'string') {
         try {
          (testObject as Test).elements = JSON.parse((testObject as Test).elements as any);
        } catch (e) {
          resolvedLogger.warn({ message: "Failed to parse UI test elements from string", testId: testObject.id, elements: (testObject as Test).elements });
        }
      }


      const result = await runTest(testObject, userId, planId, testPlanRunId, testTypeForRun);
      individualTestResults.push(result);

      if (!result.success) {
        overallStatus = (overallStatus === 'passed') ? 'failed' : 'partial';
        if (result.status === 'error' && overallStatus !== 'partial') overallStatus = 'partial'; // If one test errors, but others might pass/fail
      } else if (result.success && overallStatus === 'failed') {
        overallStatus = 'partial'; // If previous failed, now one passed -> partial
      }
      // If overallStatus is already 'partial', it remains 'partial' unless all subsequent tests pass making it 'partial' from 'failed'
      // or if a new failure occurs while it was 'passed', making it 'failed', then 'partial' if a subsequent one passes.

      // Update TestPlanRun with partial results (optional, for real-time updates)
      try {
        await db.update(testPlanExecutionsTable)
          .set({ results: JSON.stringify(individualTestResults) }) // Store results as JSON string
          .where(eq(testPlanExecutionsTable.id, testPlanRunId));
      } catch (dbUpdateError: any) {
        resolvedLogger.error({ message: 'Failed to update TestPlanRun with partial results', testPlanRunId, error: dbUpdateError.message });
        // Continue execution if possible, final update will happen later
      }

    } else {
      resolvedLogger.warn({ message: `Test object not found or type mismatch for link`, linkId: link.id, testId: link.testId, apiTestId: link.apiTestId, type: link.testType });
      // Potentially add a placeholder error result to individualTestResults
      individualTestResults.push({
        testId: link.testId || link.apiTestId || -1,
        testType: (link.testType as 'ui' | 'api' || 'unknown') as 'ui' | 'api',
        name: `Unknown Test (ID: ${link.testId || link.apiTestId})`,
        success: false,
        status: 'error',
        error: 'Test definition not found or type mismatch.',
        durationMs: 0,
      });
      overallStatus = (overallStatus === 'passed') ? 'failed' : 'partial';
    }
  }

  // Final determination of overallStatus
  const allTestsPassed = individualTestResults.every(r => r.success);
  const anyTestFailed = individualTestResults.some(r => !r.success);

  if (individualTestResults.length === 0) {
    overallStatus = 'passed'; // Or 'error'/'empty' if no tests is considered an issue
    resolvedLogger.warn({ message: 'Test plan execution completed, but no tests were selected or found.', planId, testPlanRunId });
  } else if (allTestsPassed) {
    overallStatus = 'passed';
  } else if (anyTestFailed && !allTestsPassed) {
    overallStatus = 'partial';
  } else { // implies anyTestFailed is true and allTestsPassed is false
    overallStatus = 'failed';
  }
   if (individualTestResults.some(r => r.status === 'error') && overallStatus !== 'partial') {
    // If any test had an execution error, and the plan isn't already 'partial' due to mixed pass/fail,
    // mark it as 'partial' to indicate some tests didn't run cleanly.
    // If all tests errored, it would become 'failed' by the logic above (all !r.success).
    // This handles cases where some pass/fail and others error.
    if (overallStatus === 'passed') overallStatus = 'partial';
    // if overallStatus is 'failed' because ALL tests failed (some perhaps with 'error' status), it remains 'failed'.
  }


  // 5. Update TestPlanRun record with final status and results
  const completedAt = Math.floor(Date.now() / 1000);
  try {
    const finalUpdate = await db.update(testPlanExecutionsTable)
      .set({
        status: overallStatus,
        results: JSON.stringify(individualTestResults),
        completedAt: completedAt,
      })
      .where(eq(testPlanExecutionsTable.id, testPlanRunId))
      .returning();

    if (finalUpdate.length > 0) {
      resolvedLogger.info({ message: `Test plan execution completed and DB updated`, planId, testPlanRunId, overallStatus, numberOfTests: individualTestResults.length });
      return finalUpdate[0]; // Return the completed TestPlanRun object
    } else {
      resolvedLogger.error({ message: `Failed to perform final update on TestPlanRun DB record`, planId, testPlanRunId });
      // Fallback: construct the object manually if DB update failed but we have data
      return {
        id: testPlanRunId,
        testPlanId: planId,
        status: overallStatus,
        results: individualTestResults, // Return as object array, not JSON string
        startedAt: currentTestPlanRun?.startedAt, // from initial insert
        completedAt: completedAt,
        error: "Failed to finalize database record, but execution completed."
      };
    }
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'CRITICAL: Failed to update TestPlanRun with final results in DB', planId, testPlanRunId, error: dbError.message, stack: dbError.stack });
    return {
      id: testPlanRunId,
      testPlanId: planId,
      status: 'error', // Indicate DB error for the plan run itself
      results: individualTestResults,
      startedAt: currentTestPlanRun?.startedAt,
      completedAt: completedAt,
      error: `DB error during final update: ${dbError.message}`
    };
  }
}
