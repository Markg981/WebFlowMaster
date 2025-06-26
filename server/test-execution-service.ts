import { playwrightService } from './playwright-service';
import type { Test, ApiTest, TestPlan, TestPlanExecution, InsertReportTestCaseResult } from '@shared/schema'; // Assuming ApiTest will be defined or Test is generic enough
import type { StepResult } from './playwright-service'; // Import StepResult type
import loggerPromise from './logger';
import { db } from './db';
import {
  tests as testsTable,
  apiTests as apiTestsTable,
  testPlanSelectedTests,
  testPlans,
  testPlanExecutions as testPlanExecutionsTable,
  reportTestCaseResults as reportTestCaseResultsTable // Added
} from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm'; // Added sql
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
): Promise<TestPlanExecution | { error: string; status?: number; testPlanRunId?: string }> { // Return type updated
  const resolvedLogger = await loggerPromise;
  const testPlanRunId = uuidv4();
  const overallStartTime = Date.now(); // For overall execution duration

  resolvedLogger.info({ message: `Starting test plan execution`, planId, testPlanRunId, userId });

  const planResult = await db.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1);
  if (!planResult || planResult.length === 0) {
    resolvedLogger.error({ message: `Test Plan not found`, planId, testPlanRunId });
    return { error: 'Test Plan not found', status: 404 };
  }
  const testPlan = planResult[0];

  let currentTestPlanRun: TestPlanExecution;
  try {
    const inserted = await db.insert(testPlanExecutionsTable)
      .values({
        id: testPlanRunId,
        testPlanId: planId,
        status: 'running',
        startedAt: Math.floor(overallStartTime / 1000), // Record precise start time
        // environment and browsers could be copied from plan or schedule if this was a scheduled run
        environment: testPlan.name, // Placeholder, ideally from schedule or manual run config
        triggeredBy: 'manual', // Assuming manual run for now
      })
      .returning();
    currentTestPlanRun = inserted[0];
    resolvedLogger.info({ message: 'Initial TestPlanRun record created', testPlanRunId, dbId: currentTestPlanRun.id });
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'Failed to create initial TestPlanRun record in DB', planId, testPlanRunId, error: dbError.message, stack: dbError.stack });
    return { error: `Failed to initialize test plan run: ${dbError.message}`, status: 500 };
  }

  const baseResultsDir = path.join('./results', planId, testPlanRunId);
  try {
    await fs.ensureDir(baseResultsDir);
  } catch (dirError: any) {
    resolvedLogger.error({ message: 'Failed to create base results directory', baseResultsDir, error: dirError.message });
    await db.update(testPlanExecutionsTable).set({
      status: 'error',
      completedAt: Math.floor(Date.now() / 1000),
      results: JSON.stringify([{ error: `Failed to create results directory: ${dirError.message}` }]),
      executionDurationMs: Date.now() - overallStartTime,
    }).where(eq(testPlanExecutionsTable.id, testPlanRunId));
    return { error: `Failed to create results directory: ${dirError.message}`, status: 500, testPlanRunId };
  }

  const selectedTestsLinks = await db
    .select()
    .from(testPlanSelectedTests)
    .where(eq(testPlanSelectedTests.testPlanId, planId));

  const legacyIndividualTestResultsForJsonBlob: IndividualTestRunResult[] = [];

  for (const link of selectedTestsLinks) {
    let testObjectDefinition: Test | ApiTest | undefined;
    let testTypeForRun: 'ui' | 'api' | undefined = link.testType as ('ui' | 'api');

    if (link.testId && link.testType === 'ui') {
      // Fetch UI test with new metadata fields
      const uiTestArr = await db.select().from(testsTable).where(eq(testsTable.id, link.testId)).limit(1);
      if (uiTestArr.length > 0) testObjectDefinition = uiTestArr[0];
    } else if (link.apiTestId && link.testType === 'api') {
      // Fetch API test with new metadata fields
      const apiTestArr = await db.select().from(apiTestsTable).where(eq(apiTestsTable.id, link.apiTestId)).limit(1);
      if (apiTestArr.length > 0) testObjectDefinition = apiTestArr[0];
    }

    const singleTestStartTime = Date.now();
    let reportStatus: InsertReportTestCaseResult['status'] = 'Pending'; // Default
    let failureReason: string | undefined = undefined;
    let screenshotFinalPath: string | undefined = undefined;
    let stepsOrLogData: string | undefined = undefined;

    if (testObjectDefinition && testTypeForRun) {
      if (testTypeForRun === 'ui' && typeof (testObjectDefinition as Test).sequence === 'string') {
        try { (testObjectDefinition as Test).sequence = JSON.parse((testObjectDefinition as Test).sequence as any); }
        catch (e) { resolvedLogger.warn("Failed to parse UI test sequence"); }
      }
      if (testTypeForRun === 'ui' && typeof (testObjectDefinition as Test).elements === 'string') {
        try { (testObjectDefinition as Test).elements = JSON.parse((testObjectDefinition as Test).elements as any); }
        catch (e) { resolvedLogger.warn("Failed to parse UI test elements"); }
      }

      const resultFromRunTest = await runTest(testObjectDefinition, userId, planId, testPlanRunId, testTypeForRun);
      legacyIndividualTestResultsForJsonBlob.push(resultFromRunTest); // Keep populating the old JSON blob for now

      // Map runTest result to reportTestCaseResults status
      if (resultFromRunTest.status === 'passed') reportStatus = 'Passed';
      else if (resultFromRunTest.status === 'failed') reportStatus = 'Failed';
      else if (resultFromRunTest.status === 'error') reportStatus = 'Error';
      // 'Skipped' needs to be handled if runTest can produce it

      failureReason = resultFromRunTest.error;
      screenshotFinalPath = resultFromRunTest.screenshotPath; // This is a file path
      stepsOrLogData = resultFromRunTest.steps ? JSON.stringify(resultFromRunTest.steps) : undefined; // For UI tests

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
      testPlanExecutionId: testPlanRunId,
      uiTestId: link.testType === 'ui' ? link.testId : null,
      apiTestId: link.testType === 'api' ? link.apiTestId : null,
      testType: link.testType as 'ui' | 'api',
      testName: testObjectDefinition?.name || `Unknown Test (ID: ${link.testId || link.apiTestId})`,
      status: reportStatus,
      reasonForFailure: failureReason,
      screenshotUrl: screenshotFinalPath,
      detailedLog: stepsOrLogData, // Or specific log for API tests
      startedAt: Math.floor(singleTestStartTime / 1000),
      completedAt: Math.floor(singleTestEndTime / 1000),
      durationMs: singleTestDurationMs,
      module: testObjectDefinition?.module || null,
      featureArea: testObjectDefinition?.featureArea || null,
      scenario: testObjectDefinition?.scenario || null,
      component: testObjectDefinition?.component || null,
      priority: testObjectDefinition?.priority || null,
      severity: testObjectDefinition?.severity || null, // This is designed severity. Runtime severity could differ.
    };

    try {
      await db.insert(reportTestCaseResultsTable).values(newReportEntry);
    } catch (dbInsertError: any) {
      resolvedLogger.error({ message: 'Failed to insert into reportTestCaseResultsTable', entry: newReportEntry, error: dbInsertError.message });
      // Continue execution, this test result might be missing from detailed report but plan will complete.
    }
  } // End of loop for selectedTestsLinks

  // After all tests have run, calculate final aggregates from reportTestCaseResultsTable
  const finalDetailedResults = await db.select()
                                   .from(reportTestCaseResultsTable)
                                   .where(eq(reportTestCaseResultsTable.testPlanExecutionId, testPlanRunId));

  const calculatedTotalTests = finalDetailedResults.length;
  const calculatedPassedTests = finalDetailedResults.filter(r => r.status === 'Passed').length;
  const calculatedFailedTests = finalDetailedResults.filter(r => r.status === 'Failed').length;
  const calculatedSkippedTests = finalDetailedResults.filter(r => r.status === 'Skipped').length;
  // Consider 'Error' status as failures or a separate category if needed for overall status.
  // For overall status, let's say if any 'Failed' or 'Error', the whole run is 'failed'.
  // If any 'Skipped' and no 'Failed'/'Error', maybe 'partial' or 'completed_with_skipped'.
  // If all 'Passed', then 'completed'.

  let finalOverallStatus: TestPlanExecution['status'] = 'pending'; // Should be 'completed' or 'failed' or 'error'
  if (calculatedTotalTests === 0 && selectedTestsLinks.length > 0) {
    finalOverallStatus = 'error'; // No results recorded but tests were expected
  } else if (calculatedFailedTests > 0 || finalDetailedResults.some(r => r.status === 'Error')) {
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
    const finalUpdateResult = await db.update(testPlanExecutionsTable)
      .set({
        status: finalOverallStatus,
        results: JSON.stringify(legacyIndividualTestResultsForJsonBlob), // Keep the old JSON blob for now
        completedAt: Math.floor(overallCompletedAt / 1000),
        totalTests: calculatedTotalTests,
        passedTests: calculatedPassedTests,
        failedTests: calculatedFailedTests,
        skippedTests: calculatedSkippedTests,
        executionDurationMs: overallExecutionDurationMs,
      })
      .where(eq(testPlanExecutionsTable.id, testPlanRunId))
      .returning();

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
      completedAt: Math.floor(overallCompletedAt / 1000),
      error: `DB error during final aggregate update: ${dbError.message}`
    } as any;
  }
}
