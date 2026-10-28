import { asyncRouter } from '../../platform/middleware/async-router';
import { flattenZodError } from '../zod-error';
import { checkRunOn } from '../../runtime/browser-grids';
import {
  testPlans,
  testPlanSchedules,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlanSuites,
  testSuites,
  tests,
  apiTests,
  mobileTests,
  executionLogs,
  reportTestCaseResults,
  insertTestPlanScheduleSchema,
  updateTestPlanScheduleSchema,
  testPlanApiPayloadSchema,
  updateTestPlanApiPayloadSchema,
  type ReportTestCaseResult,
  type TestPlanSchedule,
} from '@shared/schema';
import {
  eq,
  desc,
  asc,
  and,
  or,
  inArray,
  count,
  getTableColumns,
  sql,
  type SQL,
} from 'drizzle-orm';
import { listPage, setTotalCount } from '../list-page';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../platform/logger';
import schedulerService, {
  assertValidTimezone,
  DEFAULT_SCHEDULE_TIMEZONE,
  firstRunAt,
} from '../../execution/scheduler-service';
import {
  runAsOrganization,
  withTenantTransaction,
  type TenantTx,
} from '../../platform/middleware/tenancy';
import { expandPlanTests, type TestReference } from '../../authoring/test-suites';
import { requireRole } from '../middleware/require-role';
import { asyncHandler } from '../../platform/middleware/async-handler';
import { assertSelectedTestsBelongTo, SELECTED_TESTS_NOT_FOUND } from './selected-tests';
import { requestCancellation } from '../../execution/execution-state';
import { AUDIT_ACTIONS } from '@shared/schema';
import { auditActor, changedFields, recordAudit } from '../../tenancy/audit';
import { publicExecution, reproducibilitySummary } from '../../execution/execution-provenance';
import { executionArtifactAvailability } from '../../tenancy/artifact-metering';
import { relativeArtifactPath, runArtifactAccess } from '../../tenancy/artifact-access';
import { readAttempts, unitEvidenceView } from '../../execution/execution-units';
import { evidenceLinker } from '../../reporting/unit-evidence';
import { evidencePrincipalOf } from '../middleware/require-scope';
import { readExecutionSnapshot } from '../../execution/execution-snapshot';
import { dedupeKeyFor } from '../../integrations/issue-tracking';
import { artifactUrl, stepsWithArtifactUrls } from './artifacts.routes';
import { linkedIssuesFor } from './issues.routes';

const router = asyncRouter();

// jsonb columns are stored via JSON.stringify (codebase convention) and parsed back
// on read. Re-fetches a schedule joined with its test plan name, with JSON fields parsed.
// Takes the already-open tenant transaction rather than opening its own: it is always
// called from inside a withTenantTransaction callback, and a second transaction there
// would deadlock under PGlite (see withTenantTransaction's doc comment).
async function fetchScheduleWithPlanName(tx: TenantTx, id: string) {
  const rows = await tx
    .select({ ...getTableColumns(testPlanSchedules), testPlanName: testPlans.name })
    .from(testPlanSchedules)
    .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
    .where(eq(testPlanSchedules.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const s = rows[0];
  return {
    ...s,
    browsers: typeof s.browsers === 'string' ? JSON.parse(s.browsers) : s.browsers,
    notificationConfigOverride:
      typeof s.notificationConfigOverride === 'string'
        ? JSON.parse(s.notificationConfigOverride)
        : s.notificationConfigOverride,
    executionParameters:
      typeof s.executionParameters === 'string'
        ? JSON.parse(s.executionParameters)
        : s.executionParameters,
  };
}

function isForeignKeyError(e: any): boolean {
  return !!e?.message && e.message.toLowerCase().includes('foreign key');
}

// --- Test Plans ---

router.get('/api/test-plans', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  // No organization filter here on purpose: the RLS policy applies it.
  const { limit, offset } = listPage(req);
  const { plans, total } = await withTenantTransaction(async (tx) => {
    const [counted] = await tx.select({ n: count() }).from(testPlans);
    const rows = await tx
      .select()
      .from(testPlans)
      .orderBy(desc(testPlans.createdAt), desc(testPlans.id))
      .limit(limit)
      .offset(offset);
    return { plans: rows, total: counted?.n ?? 0 };
  });
  setTotalCount(res, total);
  res.json(plans);
});

router.post('/api/test-plans', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });

  const parseResult = testPlanApiPayloadSchema.safeParse(req.body);
  if (!parseResult.success)
    return res
      .status(400)
      .json({ error: 'Invalid data', details: flattenZodError(parseResult.error) });

  // selectedTests lives in a separate join table (testPlanSelectedTests) rather than as a
  // column on testPlans, so it is inserted separately below — not dropped. It used to be
  // destructured away and discarded here, which meant every plan created from the UI had
  // zero linked tests: CreateTestPlanWizard always sends this field.
  // Agents or a grid, never both, and only a grid of this organization (server/runtime/browser-grids.ts).
  const runOn = await checkRunOn(parseResult.data);
  if (!runOn.ok) return res.status(400).json({ error: runOn.error });
  const { selectedTests, ...planData } = { ...parseResult.data, ...runOn.changes };

  const planId = uuidv4();
  try {
    const newPlan = await withTenantTransaction(async (tx) => {
      const inserted = await tx
        .insert(testPlans)
        .values({
          ...planData,
          id: planId,
          // The tenancy boundary: always derived from the authenticated session, never
          // trusted from the request body (testPlanApiPayloadSchema omits both fields).
          userId: req.user!.id,
          organizationId: req.user!.organizationId,
          testMachinesConfig: planData.testMachinesConfig
            ? JSON.stringify(planData.testMachinesConfig)
            : null,
          notificationSettings: planData.notificationSettings
            ? JSON.stringify(planData.notificationSettings)
            : null,
        })
        .returning();

      const mainPlan = inserted[0];

      if (selectedTests && selectedTests.length > 0) {
        // Nothing downstream re-checks these ids — test-execution-service loads them with
        // inArray and no organization filter — so an unvalidated foreign id would mean the
        // runner executes another tenant's test.
        await assertSelectedTestsBelongTo(tx, req.user!.organizationId, selectedTests);
        await tx.insert(testPlanSelectedTests).values(
          selectedTests.map((st) => ({
            testPlanId: mainPlan.id,
            // From the plan these rows hang off, not from the session: a join row belongs
            // to the same organization as its parent.
            organizationId: mainPlan.organizationId,
            testId: st.type === 'ui' ? st.id : null,
            apiTestId: st.type === 'api' ? st.id : null,
            mobileTestId: st.type === 'mobile' ? st.id : null,
            testType: st.type,
          })),
        );
      }

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.PLAN_CREATED,
        actor: auditActor(req),
        targetType: 'test_plan',
        targetId: mainPlan.id,
        metadata: { name: mainPlan.name, tests: selectedTests?.length ?? 0 },
      });

      return mainPlan;
    });
    res.status(201).json(newPlan);
  } catch (e: any) {
    // Either the DB rejected an id that does not exist at all, or the check above rejected
    // one that exists in another organization. Both are the caller naming a test that is
    // not theirs to name, and both answer the same way — a distinct message for the second
    // would tell them which ids exist in other tenants.
    if (SELECTED_TESTS_NOT_FOUND.test(e.message || '') || isForeignKeyError(e)) {
      return res.status(400).json({ error: 'One or more selected tests do not exist.' });
    }
    logger.error({ message: 'Plan creation failed', error: e.message });
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

router.get('/api/test-plans/:id', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const plan = await withTenantTransaction((tx) =>
    tx.select().from(testPlans).where(eq(testPlans.id, req.params.id)).limit(1),
  );
  if (plan.length === 0) return res.status(404).json({ error: 'Test plan not found.' });
  res.json(plan[0]);
});

/**
 * GET /api/test-plans/:id/contents — what a run of this plan would execute, and its latest run.
 *
 * A plan is the organization's (migration 0031): everyone sees it, and it runs a restricted
 * project's tests whoever presses Run. So the list is worked out as the organization, exactly as
 * creating a run does, and only the names go through the requester's own view: a test in a
 * project they cannot see is counted, not named — the same answer a suite gives. Without this a
 * viewer had no way to open a plan at all, and nobody could tell from the plan that it ran a
 * restricted project's tests.
 */
router.get('/api/test-plans/:id/contents', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const planId = req.params.id;
    const [plan] = await withTenantTransaction((tx) =>
      tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, planId)).limit(1),
    );
    if (!plan) return res.status(404).json({ error: 'Not found' });

    const refs = await runAsOrganization(req.user.organizationId, () =>
      withTenantTransaction(async (tx) => {
        const direct = await tx
          .select({
            testType: testPlanSelectedTests.testType,
            testId: testPlanSelectedTests.testId,
            apiTestId: testPlanSelectedTests.apiTestId,
            mobileTestId: testPlanSelectedTests.mobileTestId,
          })
          .from(testPlanSelectedTests)
          .where(eq(testPlanSelectedTests.testPlanId, planId))
          .orderBy(asc(testPlanSelectedTests.id));
        return expandPlanTests(tx, planId, direct as TestReference[]);
      }),
    );

    const view = await withTenantTransaction(async (tx) => {
      const uiIds = refs.filter((r) => r.testType === 'ui').map((r) => r.testId!);
      const apiIds = refs.filter((r) => r.testType === 'api').map((r) => r.apiTestId!);
      const uiNames = new Map(
        uiIds.length
          ? (
              await tx
                .select({ id: tests.id, name: tests.name })
                .from(tests)
                .where(inArray(tests.id, uiIds))
            ).map((t) => [t.id, t.name])
          : [],
      );
      const apiNames = new Map(
        apiIds.length
          ? (
              await tx
                .select({ id: apiTests.id, name: apiTests.name })
                .from(apiTests)
                .where(inArray(apiTests.id, apiIds))
            ).map((t) => [t.id, t.name])
          : [],
      );
      const mobileIds = refs.filter((r) => r.testType === 'mobile').map((r) => r.mobileTestId!);
      const mobileNames = new Map(
        mobileIds.length
          ? (
              await tx
                .select({ id: mobileTests.id, name: mobileTests.name })
                .from(mobileTests)
                .where(inArray(mobileTests.id, mobileIds))
            ).map((t) => [t.id, t.name])
          : [],
      );
      // Suites through RLS as well: one in a project the requester cannot see is not listed,
      // though its tests are still counted above.
      const suites = await tx
        .select({ id: testSuites.id, name: testSuites.name })
        .from(testPlanSuites)
        .innerJoin(testSuites, eq(testSuites.id, testPlanSuites.suiteId))
        .where(eq(testPlanSuites.testPlanId, planId))
        .orderBy(asc(testPlanSuites.position));
      const [latestRun] = await tx
        .select({
          id: testPlanExecutions.id,
          status: testPlanExecutions.status,
          startedAt: testPlanExecutions.startedAt,
        })
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.testPlanId, planId))
        .orderBy(desc(testPlanExecutions.startedAt))
        .limit(1);
      return {
        tests: refs.map((r) =>
          r.testType === 'ui'
            ? { type: 'ui' as const, id: r.testId!, name: uiNames.get(r.testId!) ?? null }
            : r.testType === 'mobile'
              ? {
                  type: 'mobile' as const,
                  id: r.mobileTestId!,
                  name: mobileNames.get(r.mobileTestId!) ?? null,
                }
              : {
                  type: 'api' as const,
                  id: r.apiTestId!,
                  name: apiNames.get(r.apiTestId!) ?? null,
                },
        ),
        suites,
        latestRun: latestRun ?? null,
      };
    });
    res.json(view);
  } catch (e: any) {
    logger.error({
      message: "Failed to read a plan's contents",
      error: e?.message ?? String(e),
      planId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to load the plan.' });
  }
});

// PUT /api/test-plans/:id - Update an existing test plan
router.put('/api/test-plans/:id', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const testPlanId = req.params.id;

  const parseResult = updateTestPlanApiPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({
      message: `PUT /api/test-plans/${testPlanId} - Invalid payload`,
      errors: flattenZodError(parseResult.error),
      userId: (req.user as any)?.id,
    });
    return res
      .status(400)
      .json({ error: 'Invalid request payload', details: flattenZodError(parseResult.error) });
  }

  // Agents or a grid, never both, and only a grid of this organization (server/runtime/browser-grids.ts).
  const runOn = await checkRunOn(parseResult.data);
  if (!runOn.ok) return res.status(400).json({ error: runOn.error });

  try {
    const { selectedTests, ...planUpdates } = { ...parseResult.data, ...runOn.changes };

    // Check if there's anything to update for the main plan or selected tests
    if (Object.keys(planUpdates).length === 0 && selectedTests === undefined) {
      // Check if the plan exists first to return 404 if not, otherwise 400 for no data
      const existingPlanCheck = await withTenantTransaction((tx) =>
        tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId)),
      );
      if (existingPlanCheck.length === 0) {
        return res.status(404).json({ error: 'Test plan not found.' });
      }
      return res.status(400).json({ error: 'No update data provided.' });
    }

    // withTenantTransaction, not privilegedDb.transaction: RLS is silently inert under a
    // superuser, so the explicit organizationId predicates below were the only thing scoping
    // this handler. They stay, but they are now belt as well as braces.
    const updatedPlanResult = await withTenantTransaction(async (tx) => {
      let mainPlanUpdated;
      if (Object.keys(planUpdates).length > 0) {
        // Stringify JSON fields before updating: both columns are typed as their parsed
        // object shape while the DB stores them as text.
        const updatesToApply = { ...planUpdates } as Record<string, unknown>;
        if (planUpdates.testMachinesConfig !== undefined) {
          updatesToApply.testMachinesConfig = planUpdates.testMachinesConfig
            ? JSON.stringify(planUpdates.testMachinesConfig)
            : null;
        }
        if (planUpdates.notificationSettings !== undefined) {
          updatesToApply.notificationSettings = planUpdates.notificationSettings
            ? JSON.stringify(planUpdates.notificationSettings)
            : null;
        }

        mainPlanUpdated = await tx
          .update(testPlans)
          .set({
            ...updatesToApply,
            // A Date, not unix seconds: updatedAt is a `timestamp` column, and drizzle
            // calls .toISOString() on whatever it is given. The previous number made every
            // PUT that touched a plan field fail with "value.toISOString is not a function".
            updatedAt: new Date(),
          })
          // Scoped to the caller's organization, so another tenant's plan is simply not
          // there. Without this the handler would happily update any plan by id, and the
          // join rows below would then be stamped with the foreign plan's organization
          // while naming tests from the caller's — a row that is internally cross-tenant.
          .where(
            and(
              eq(testPlans.id, testPlanId),
              eq(testPlans.organizationId, req.user.organizationId),
            ),
          )
          .returning();

        if (mainPlanUpdated.length === 0) {
          // The id goes in the metadata, not the message: it comes from the URL.
          logger.warn('PUT /api/test-plans/:id - Test plan not found during main record update.', {
            testPlanId,
          });
          throw new Error('Test plan not found or no changes to main record.'); // Will be caught and result in 404 like
        }
      } else {
        // If only selectedTests are being updated, fetch the current plan to return.
        // Same organization scope as the update branch above.
        const currentPlan = await tx
          .select()
          .from(testPlans)
          .where(
            and(
              eq(testPlans.id, testPlanId),
              eq(testPlans.organizationId, req.user.organizationId),
            ),
          );
        if (currentPlan.length === 0) {
          throw new Error('Test plan not found.');
        }
        mainPlanUpdated = currentPlan;
      }

      if (selectedTests !== undefined) {
        // If selectedTests is provided (even an empty array)
        await tx
          .delete(testPlanSelectedTests)
          .where(eq(testPlanSelectedTests.testPlanId, testPlanId));

        if (selectedTests.length > 0) {
          await assertSelectedTestsBelongTo(tx, req.user.organizationId, selectedTests);
          const selectedTestValues = selectedTests.map((st) => ({
            testPlanId: testPlanId,
            // Taken from the plan these rows hang off, not from the session: a join row must
            // belong to the same organization as its parent, and those can differ whenever
            // the caller reaches a plan that isn't theirs.
            organizationId: mainPlanUpdated[0].organizationId,
            testId: st.type === 'ui' ? st.id : null,
            apiTestId: st.type === 'api' ? st.id : null,
            mobileTestId: st.type === 'mobile' ? st.id : null,
            testType: st.type,
          }));
          await tx.insert(testPlanSelectedTests).values(selectedTestValues);
        }
      }

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.PLAN_UPDATED,
        actor: auditActor(req),
        targetType: 'test_plan',
        targetId: testPlanId,
        metadata: {
          name: mainPlanUpdated[0].name,
          fields: changedFields(parseResult.data as Record<string, unknown>),
          ...(selectedTests !== undefined ? { tests: selectedTests.length } : {}),
        },
      });
      return mainPlanUpdated[0]; // Return the first element of the (potentially) updated plan
    });

    if (!updatedPlanResult) {
      // Should be caught by transaction error handling but as a safeguard
      return res.status(404).json({ error: 'Test plan not found or no effective changes made.' });
    }
    res.json(updatedPlanResult);
  } catch (error: any) {
    logger.error({
      message: `Error updating test plan ${testPlanId}`,
      error: error.message,
      stack: error.stack,
      requestBody: req.body,
      userId: (req.user as any)?.id,
    });
    if (error.message.toLowerCase().includes('test plan not found')) {
      // Custom error from transaction
      return res.status(404).json({ error: 'Test plan not found.' });
    }
    // Either the DB rejected an id that doesn't exist at all, or assertSelectedTestsBelongTo
    // rejected one that exists in another organization. Both are the caller naming a test
    // that is not theirs to name, and both answer the same way — a distinct message for the
    // second would tell them which ids exist in other tenants.
    if (
      /foreign key/i.test(error.message || '') ||
      SELECTED_TESTS_NOT_FOUND.test(error.message || '')
    ) {
      return res.status(400).json({ error: 'One or more selected tests do not exist.' });
    }
    res.status(500).json({ error: 'Failed to update test plan' });
  }
});

// DELETE /api/test-plans/:id - Delete a test plan
router.delete('/api/test-plans/:id', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const testPlanId = req.params.id;

  try {
    // onDelete: 'cascade' is defined in the schedules.testPlanId FK.
    // This means deleting a test plan will automatically delete associated schedules.
    // Also, test_plan_selected_tests and test_plan_runs have onDelete: 'cascade' for testPlanId.
    //
    // Scoped to the caller's organization (matching the PUT handler above) and run inside
    // the tenant transaction, so another tenant's plan is simply not there rather than
    // being destroyed along with its schedules and execution history.
    const result = await withTenantTransaction(async (tx) => {
      const rows = await tx
        .delete(testPlans)
        .where(
          and(eq(testPlans.id, testPlanId), eq(testPlans.organizationId, req.user!.organizationId)),
        )
        .returning();
      if (rows.length > 0) {
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PLAN_DELETED,
          actor: auditActor(req),
          targetType: 'test_plan',
          targetId: testPlanId,
          // Its schedules and run history went with it (cascade), which is worth saying.
          metadata: { name: rows[0].name },
        });
      }
      return rows;
    });

    if (result.length === 0) {
      return res.status(404).json({ error: 'Test plan not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    logger.error({
      message: `Error deleting test plan ${testPlanId}`,
      error: error.message,
      stack: error.stack,
      userId: (req.user as any)?.id,
    });
    res.status(500).json({ error: 'Failed to delete test plan' });
  }
});

// POST /api/run-test-plan/:id - Execute a test plan
router.post('/api/run-test-plan/:id', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const testPlanId = req.params.id;
  const userId = req.user.id;

  logger.http({
    message: `POST /api/run-test-plan/${testPlanId} - Handler reached`,
    testPlanId,
    userId,
  });

  try {
    // Ownership gate, through RLS: another organization's plan is simply not here. The
    // orchestrator checks the requester's organization again, and the job itself runs under
    // runWithTenant for the execution's organization (test-execution-service.ts), but a 404
    // from here is the answer a caller should get before anything is written.
    const owned = await withTenantTransaction((tx) =>
      tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId)).limit(1),
    );
    if (owned.length === 0) {
      return res.status(404).json({ error: 'Test plan not found' });
    }

    // A pipeline that retries this request after a timeout sends the same key and gets the
    // run it already started, instead of a second one.
    const idempotencyKey = req.get('Idempotency-Key')?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > 255) {
      return res
        .status(400)
        .json({ success: false, error: 'Idempotency-Key must be at most 255 characters.' });
    }

    // Dynamically import runTestPlan to avoid circular dependencies if test-execution-service grows
    const { runTestPlan } = await import('../../execution/test-execution-service');
    // `updateBaselines` is how a legitimate redesign gets a visually-tested plan out of red:
    // this run's screenshots become the baselines the next one is measured against.
    const executionResult = await runTestPlan(testPlanId, userId, {
      environmentId:
        typeof req.body?.environmentId === 'number' ? req.body.environmentId : undefined,
      updateBaselines: req.body?.updateBaselines === true,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    if ('error' in executionResult) {
      const errorResult = executionResult as {
        error: string;
        status?: number;
        testPlanRunId?: string;
      };
      // Check if a specific status code was suggested by runTestPlan
      const statusCode =
        errorResult.status && typeof errorResult.status === 'number' ? errorResult.status : 500;
      logger.error({
        message: `Test plan execution failed for plan ${testPlanId}`,
        error: errorResult.error,
        testPlanRunId: errorResult.testPlanRunId,
      });
      return res
        .status(statusCode)
        .json({ success: false, error: errorResult.error, data: executionResult });
    }

    logger.info({
      message: `Test plan ${testPlanId} executed successfully. Run ID: ${executionResult.id}`,
    });
    // executionResult should be the full TestPlanRun object
    res.status(200).json({ success: true, data: publicExecution(executionResult) });
  } catch (error: any) {
    logger.error({
      message: `Critical error in /api/run-test-plan/${testPlanId} route handler`,
      testPlanId,
      userId,
      error: error.message,
      stack: error.stack,
    });
    res
      .status(500)
      .json({ success: false, error: 'Internal server error during test plan execution.' });
  }
});

// --- Schedules ---

router.get('/api/test-plan-schedules', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  // No organization filter here on purpose: the RLS policy applies it.
  const results = await withTenantTransaction((tx) =>
    tx
      .select({
        ...getTableColumns(testPlanSchedules),
        testPlanName: testPlans.name,
      })
      .from(testPlanSchedules)
      .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
      .orderBy(desc(testPlanSchedules.createdAt)),
  );

  // Parse JSONs
  const parsed = results.map((s) => ({
    ...s,
    browsers: typeof s.browsers === 'string' ? JSON.parse(s.browsers) : s.browsers,
    executionParameters:
      typeof s.executionParameters === 'string'
        ? JSON.parse(s.executionParameters)
        : s.executionParameters,
  }));

  res.json(parsed);
});

// The schedules of one plan.
router.get(
  '/api/test-plan-schedules/plan/:planId',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    // Scoped to the ambient tenant transaction rather than privilegedDb: RLS is silently
    // inert under a superuser, so an unscoped privilegedDb query here returned every
    // organization's schedules for any plan id, including another tenant's.
    const results = await withTenantTransaction((tx) =>
      tx
        .select({
          ...getTableColumns(testPlanSchedules),
          testPlanName: testPlans.name,
        })
        .from(testPlanSchedules)
        .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
        .where(eq(testPlanSchedules.testPlanId, req.params.planId))
        .orderBy(desc(testPlanSchedules.createdAt)),
    );

    const parseJson = <T>(value: T) => (typeof value === 'string' ? JSON.parse(value) : value);
    res.json(
      results.map((schedule) => ({
        ...schedule,
        browsers: parseJson(schedule.browsers),
        notificationConfigOverride: parseJson(schedule.notificationConfigOverride),
        executionParameters: parseJson(schedule.executionParameters),
      })),
    );
  }),
);

router.post('/api/test-plan-schedules', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  const parseResult = insertTestPlanScheduleSchema.safeParse(req.body);
  if (!parseResult.success)
    return res
      .status(400)
      .json({ error: 'Invalid data', details: flattenZodError(parseResult.error) });

  const scheduleId = uuidv4();
  const data = parseResult.data;

  try {
    // Reject an unresolvable zone here, at the point the schedule is saved. Doing it
    // later, when the scheduler builds the pattern, would leave a row in the database
    // that can never be scheduled and whose failure appears in a worker log.
    if (data.timezone) {
      try {
        assertValidTimezone(data.timezone);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    // nextRunAt arrives as a Date or a unix-seconds number (schema allows both). For a CRON
    // expression it is the pattern's first occurrence in the schedule's zone, not the moment
    // the form was sent (see firstRunAt).
    const requestedRunAt =
      data.nextRunAt instanceof Date ? data.nextRunAt : new Date(data.nextRunAt * 1000);
    let nextRunAt: Date;
    try {
      nextRunAt = firstRunAt(
        data.frequency,
        requestedRunAt,
        data.timezone || DEFAULT_SCHEDULE_TIMEZONE,
      );
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const created = await withTenantTransaction(async (tx) => {
      await tx.insert(testPlanSchedules).values({
        ...data,
        id: scheduleId,
        nextRunAt,
        browsers: data.browsers ? JSON.stringify(data.browsers) : null,
        notificationConfigOverride: data.notificationConfigOverride
          ? JSON.stringify(data.notificationConfigOverride)
          : null,
        executionParameters: data.executionParameters
          ? JSON.stringify(data.executionParameters)
          : null,
        userId: (req.user as any)?.id ?? null,
        organizationId: (req.user as { organizationId: number }).organizationId,
        updatedAt: new Date(),
      });

      const schedule = await fetchScheduleWithPlanName(tx, scheduleId);
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SCHEDULE_CREATED,
        actor: auditActor(req),
        targetType: 'schedule',
        targetId: scheduleId,
        metadata: {
          name: data.scheduleName,
          planId: data.testPlanId,
          planName: schedule?.testPlanName ?? null,
          frequency: data.frequency,
        },
      });
      return schedule;
    });
    // Add to scheduler
    await schedulerService.addScheduleJob(created as any);

    res.status(201).json(created);
  } catch (e: any) {
    if (isForeignKeyError(e)) {
      return res
        .status(400)
        .json({ error: 'Invalid Test Plan ID: The specified Test Plan does not exist.' });
    }
    logger.error({ message: 'Schedule creation failed', error: e.message });
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

router.put('/api/test-plan-schedules/:id', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.params.id;

  const parseResult = updateTestPlanScheduleSchema.safeParse(req.body);
  if (!parseResult.success)
    return res
      .status(400)
      .json({ error: 'Invalid data', details: flattenZodError(parseResult.error) });
  const updates = parseResult.data;

  try {
    // Same check as on create: a zone the platform cannot resolve is the caller's
    // mistake, and saying so now beats a row that silently never runs.
    if (updates.timezone) {
      try {
        assertValidTimezone(updates.timezone);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    const values: Record<string, any> = { ...updates, updatedAt: new Date() };
    if (updates.nextRunAt !== undefined) {
      values.nextRunAt =
        updates.nextRunAt instanceof Date
          ? updates.nextRunAt
          : new Date((updates.nextRunAt as number) * 1000);
    }
    if (updates.browsers !== undefined)
      values.browsers = updates.browsers ? JSON.stringify(updates.browsers) : null;
    if (updates.notificationConfigOverride !== undefined)
      values.notificationConfigOverride = updates.notificationConfigOverride
        ? JSON.stringify(updates.notificationConfigOverride)
        : null;
    if (updates.executionParameters !== undefined)
      values.executionParameters = updates.executionParameters
        ? JSON.stringify(updates.executionParameters)
        : null;
    // Drop undefined keys so Drizzle doesn't try to set them.
    Object.keys(values).forEach((k) => values[k] === undefined && delete values[k]);

    // A change to when it runs recomputes the first run, as on create — against the row as it
    // is for whatever the request leaves out.
    if (
      updates.frequency !== undefined ||
      updates.timezone !== undefined ||
      updates.nextRunAt !== undefined
    ) {
      const [current] = await withTenantTransaction((tx) =>
        tx
          .select({
            frequency: testPlanSchedules.frequency,
            timezone: testPlanSchedules.timezone,
            nextRunAt: testPlanSchedules.nextRunAt,
          })
          .from(testPlanSchedules)
          .where(eq(testPlanSchedules.id, id))
          .limit(1),
      );
      if (!current) return res.status(404).json({ error: 'Schedule not found' });
      try {
        values.nextRunAt = firstRunAt(
          values.frequency ?? current.frequency,
          values.nextRunAt ?? current.nextRunAt,
          values.timezone ?? current.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
        );
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    // Under RLS this matches nothing for another organization's schedule (closing the
    // ownership gap this handler used to have — an id from any tenant reached this
    // query with no organization filter at all), so the 404 below is the correct
    // answer rather than a cross-tenant write.
    let updatedRow: TestPlanSchedule | undefined;
    const result = await withTenantTransaction(async (tx) => {
      const updated = await tx
        .update(testPlanSchedules)
        .set(values)
        .where(eq(testPlanSchedules.id, id))
        .returning();
      if (updated.length === 0) return null;

      updatedRow = updated[0];
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SCHEDULE_UPDATED,
        actor: auditActor(req),
        targetType: 'schedule',
        targetId: id,
        // Switching a schedule off is the change people come looking for, so it is spelled out.
        metadata: {
          name: updated[0].scheduleName,
          fields: changedFields(updates as Record<string, unknown>),
          ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
        },
      });
      return fetchScheduleWithPlanName(tx, id);
    });
    if (result === null) return res.status(404).json({ error: 'Schedule not found' });

    // Outside the transaction, like the sibling POST above: updateScheduleJob reaches
    // scheduler-service.ts, which issues its own privilegedDb.select(). A second query on
    // the handle while this transaction still holds the connection deadlocks the shared
    // PGlite client under dev/test and, under node-postgres, takes a second pool client
    // and runs outside RLS as superuser.
    await schedulerService.updateScheduleJob(updatedRow!);

    res.json(result);
  } catch (e: any) {
    if (isForeignKeyError(e)) {
      return res
        .status(400)
        .json({ error: 'Invalid Test Plan ID: The specified Test Plan does not exist.' });
    }
    logger.error({ message: 'Schedule update failed', error: e.message });
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

router.delete('/api/test-plan-schedules/:id', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.params.id;
  try {
    const deleted = await withTenantTransaction(async (tx) => {
      const rows = await tx
        .delete(testPlanSchedules)
        .where(eq(testPlanSchedules.id, id))
        .returning();
      if (rows.length > 0) {
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.SCHEDULE_DELETED,
          actor: auditActor(req),
          targetType: 'schedule',
          targetId: id,
          metadata: { name: rows[0].scheduleName, planId: rows[0].testPlanId },
        });
      }
      return rows;
    });
    if (deleted.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    schedulerService.removeScheduleJob(id);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// --- Executions ---

router.get('/api/test-plan-executions', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const { planId, scheduleId, status, triggeredBy, limit = 10, offset = 0 } = req.query;
  const pageLimit = Math.min(Math.max(1, parseInt(limit as string) || 10), 100);
  const pageOffset = Math.max(0, parseInt(offset as string) || 0);

  // Explicitly typed: an empty-initialized array captured by the withTenantTransaction
  // closure below loses TypeScript's "evolving any[]" inference (that inference only
  // tracks assignments within the declaring function, not through a nested closure).
  const conditions: SQL[] = [];
  if (planId && typeof planId === 'string')
    conditions.push(eq(testPlanExecutions.testPlanId, planId));
  if (scheduleId && typeof scheduleId === 'string')
    conditions.push(eq(testPlanExecutions.scheduleId, scheduleId));
  if (status && typeof status === 'string') conditions.push(eq(testPlanExecutions.status, status));
  if (triggeredBy && typeof triggeredBy === 'string')
    conditions.push(eq(testPlanExecutions.triggeredBy, triggeredBy));

  // No organization filter here on purpose: the RLS policy applies it.
  const results = await withTenantTransaction((tx) => {
    let query = tx
      .select({
        ...getTableColumns(testPlanExecutions),
        testPlanName: testPlans.name,
        scheduleName: testPlanSchedules.scheduleName,
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .leftJoin(testPlanSchedules, eq(testPlanExecutions.scheduleId, testPlanSchedules.id))
      .$dynamic();

    if (conditions.length > 0) query = query.where(and(...conditions));

    // When it started, or failing that when it was asked for: a queued run has no start time,
    // and nulls sort first in a descending order, which would pin queued runs to the top.
    return query
      .orderBy(desc(sql`coalesce(${testPlanExecutions.startedAt}, ${testPlanExecutions.queuedAt})`))
      .limit(pageLimit)
      .offset(pageOffset);
  });
  const parsed = results.map((e) => ({
    ...publicExecution(e),
    results: typeof e.results === 'string' ? JSON.parse(e.results) : e.results,
    browsers: typeof e.browsers === 'string' ? JSON.parse(e.browsers) : e.browsers,
  }));

  res.json({ items: parsed, limit: pageLimit, offset: pageOffset });
});

/**
 * One execution, by id.
 *
 * A pipeline starts a run and then has to wait for it, and the only way to ask "is it done
 * yet?" was to fetch the whole report — every test case row, its steps and its screenshots —
 * once every few seconds. This is the question it was actually asking.
 */
router.get('/api/test-plan-executions/:id', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  // No organization filter: RLS supplies it, so another tenant's run is simply not found.
  const rows = await withTenantTransaction((tx) =>
    tx
      .select({ ...getTableColumns(testPlanExecutions), testPlanName: testPlans.name })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(eq(testPlanExecutions.id, req.params.id))
      .limit(1),
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Test plan execution not found.' });

  const execution = rows[0];
  res.json({
    ...publicExecution(execution),
    results:
      typeof execution.results === 'string' ? JSON.parse(execution.results) : execution.results,
    browsers:
      typeof execution.browsers === 'string' ? JSON.parse(execution.browsers) : execution.browsers,
  });
});

// --- Test Execution Logs API Endpoint ---
router.get(
  '/api/test-plan-executions/:executionId/logs',
  requireRole('viewer'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { executionId } = req.params;

    try {
      // Scoped to the tenant transaction: execution_logs carries test steps and substituted
      // values, so an unscoped privilegedDb query here handed a foreign execution's full log
      // body to any authenticated caller who guessed its id.
      const logs = await withTenantTransaction((tx) =>
        tx
          .select()
          .from(executionLogs)
          .where(eq(executionLogs.testPlanExecutionId, executionId))
          .orderBy(asc(executionLogs.timestamp)),
      );

      res.json(logs);
    } catch (error: any) {
      logger.error({
        message: 'Error fetching execution logs',
        error: error.message,
        executionId,
      });
      res.status(500).json({ error: 'Failed to fetch execution logs' });
    }
  },
);

// --- Test Report Page API Endpoint ---
router.get(
  '/api/test-plan-executions/:executionId/report',
  requireRole('viewer'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { executionId } = req.params;
    const userId = req.user.id; // Assuming reports might be user-scoped in the future or for auth checks

    logger.http({
      message: `GET /api/test-plan-executions/${executionId}/report - Handler reached`,
      executionId,
      userId,
    });

    if (!executionId) {
      return res.status(400).json({ error: 'Execution ID is required.' });
    }

    try {
      // Both queries run inside the same tenant transaction: unscoped privilegedDb queries
      // here returned a foreign execution's full report — including plan and test-case names
      // — to any authenticated caller who guessed its id.
      const reportSource = await withTenantTransaction(async (tx) => {
        // 1. Fetch the main TestPlanExecution record and its associated TestPlan
        const executionDetailsResult = await tx
          .select({
            execution: getTableColumns(testPlanExecutions),
            plan: getTableColumns(testPlans),
          })
          .from(testPlanExecutions)
          .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
          .where(eq(testPlanExecutions.id, executionId))
          .limit(1);

        if (executionDetailsResult.length === 0) {
          return null;
        }

        // 2. Fetch all reportTestCaseResults for this execution
        // Ensure reportTestCaseResults is imported from @shared/schema
        const testCaseResults: ReportTestCaseResult[] = await tx
          .select()
          .from(reportTestCaseResults)
          .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
          .orderBy(desc(reportTestCaseResults.status), asc(reportTestCaseResults.testName)); // Example ordering

        // The attempt that followed this one, when a schedule's retry policy queued one — so a
        // failed attempt's report can point at the run that decided the verdict.
        const thisRun = executionDetailsResult[0].execution;
        const [nextAttempt] = await tx
          .select({
            id: testPlanExecutions.id,
            status: testPlanExecutions.status,
            attempt: testPlanExecutions.attempt,
          })
          .from(testPlanExecutions)
          .where(
            and(
              eq(testPlanExecutions.retryOfExecutionId, thisRun.retryOfExecutionId ?? thisRun.id),
              eq(testPlanExecutions.attempt, thisRun.attempt + 1),
            ),
          )
          .limit(1);

        // Every attempt of the same occurrence, in order: "attempt 1 of 3 failed, 2 of 3 failed,
        // 3 of 3 passed" is the history a retry policy produces, and each report shows all of it.
        const firstAttemptId = thisRun.retryOfExecutionId ?? thisRun.id;
        const attemptHistory =
          thisRun.maxAttempts > 1
            ? await tx
                .select({
                  id: testPlanExecutions.id,
                  attempt: testPlanExecutions.attempt,
                  status: testPlanExecutions.status,
                  startedAt: testPlanExecutions.startedAt,
                  completedAt: testPlanExecutions.completedAt,
                })
                .from(testPlanExecutions)
                .where(
                  or(
                    eq(testPlanExecutions.id, firstAttemptId),
                    eq(testPlanExecutions.retryOfExecutionId, firstAttemptId),
                  ),
                )
                .orderBy(asc(testPlanExecutions.attempt))
            : [];

        // What the run warned about — a browser that ran on another engine, an OS or a browser
        // version it could not apply — for the report's header, not only its console.
        const warnings = await tx
          .select({ message: executionLogs.message })
          .from(executionLogs)
          .where(
            and(
              eq(executionLogs.testPlanExecutionId, executionId),
              eq(executionLogs.level, 'warn'),
              eq(executionLogs.source, 'system'),
            ),
          )
          .orderBy(asc(executionLogs.timestamp));

        // The issues already filed for these tests, so a failure offers "Open in tracker".
        const issues = (await linkedIssuesFor(tx, executionId)) ?? [];

        // Which of the run's files this caller may be linked to (server/tenancy/artifact-access.ts).
        const access = await runArtifactAccess(tx, {
          organizationId: thisRun.organizationId,
          executionId,
          principal: evidencePrincipalOf(req),
        });
        // Every try at each unit, with what it left behind: the report's drill-down (P08).
        const unitAttempts = await readAttempts(tx, executionId);

        return {
          ...executionDetailsResult[0],
          testCaseResults,
          nextAttempt: nextAttempt ?? null,
          attemptHistory,
          warnings: Array.from(new Set(warnings.map((w) => w.message))),
          issues,
          access,
          unitAttempts,
        };
      });

      if (!reportSource) {
        logger.warn({ message: `Execution ID ${executionId} not found.`, userId });
        return res.status(404).json({ error: 'Test plan execution not found.' });
      }

      const {
        execution,
        plan,
        testCaseResults,
        nextAttempt,
        attemptHistory,
        warnings,
        issues,
        access,
        unitAttempts,
      } = reportSource;
      const issueFor = (r: { testName: string; browser: string | null }) => {
        const key = dedupeKeyFor({
          planId: execution.testPlanId,
          testName: r.testName,
          browser: r.browser,
        });
        const link = issues.find((issue) => issue.dedupeKey === key);
        return link
          ? {
              key: link.issueKey,
              url: link.issueUrl,
              occurrences: link.occurrences,
              resolvedAt: link.resolvedAt,
            }
          : null;
      };

      // A run whose evidence retention has removed links to nothing: its images would all be
      // broken, and the header says why they are not there instead.
      const purged = !!execution.artifactsPurgedAt;
      const retained = await executionArtifactAvailability(
        execution.organizationId,
        execution.testPlanId,
        executionId,
      );
      // A link only to what the caller may open: hiding it in the page would protect nothing, the
      // download route decides the same way, and this keeps the page from offering a 403.
      const linkable = (relative: string) => retained(relative) && access.linkable(relative);
      const openable = (storedPath: string | null | undefined) =>
        purged ? null : artifactUrl(executionId, storedPath, linkable);
      // Kept raw evidence (a trace, a HAR) the caller may not open: the page says why it has no link.
      const evidenceRestricted = (r: ReportTestCaseResult) =>
        !purged &&
        [r.traceUrl, r.harUrl, r.videoUrl, r.screenshotUrl].some((storedPath) => {
          const relative = relativeArtifactPath(executionId, storedPath);
          return !!relative && retained(relative) && access.restricted(relative);
        });
      // A row of a unit of the run's manifest opens on every attempt and dataset row of it, each
      // with its own evidence; a historical row has none, and keeps the links above (P08).
      const linker = evidenceLinker({ executionId, base: 'session', access, retained, purged });
      const unitEvidenceOf = (r: ReportTestCaseResult) =>
        r.executionUnitId
          ? unitEvidenceView(
              r.executionUnitId,
              r.unitAttempt,
              unitAttempts.get(r.executionUnitId) ?? [],
              linker,
            )
          : null;
      const stepsOf = (detailedLog: string | null | undefined) => {
        const steps = stepsWithArtifactUrls(executionId, detailedLog, linkable);
        if (!purged) return steps;
        return steps.map((step) => ({
          ...step,
          screenshot: null,
          visual: step.visual
            ? { ...step.visual, baselineImage: null, actualImage: null, diffImage: null }
            : undefined,
        }));
      };

      // 3. Calculate Key Metrics
      const totalTests = testCaseResults.length;
      const passedTests = testCaseResults.filter((r) => r.status === 'Passed').length;
      const failedTests = testCaseResults.filter((r) => r.status === 'Failed').length;
      const skippedTests = testCaseResults.filter((r) => r.status === 'Skipped').length;
      // Add other statuses if needed (e.g., 'Error', 'Pending')

      let totalDurationMs = 0;
      testCaseResults.forEach((r) => {
        if (r.durationMs !== null && r.durationMs !== undefined) {
          totalDurationMs += r.durationMs;
        }
      });
      const averageTimePerTest = totalTests > 0 ? Math.round(totalDurationMs / totalTests) : 0;

      // 4. Prepare data for charts
      const passFailSkippedDistribution = {
        passed: passedTests,
        failed: failedTests,
        skipped: skippedTests,
      };

      const priorityDistribution: Record<
        string,
        { passed: number; failed: number; skipped: number; total: number }
      > = {};
      testCaseResults.forEach((r) => {
        const prio = r.priority || 'N/A';
        if (!priorityDistribution[prio]) {
          priorityDistribution[prio] = { passed: 0, failed: 0, skipped: 0, total: 0 };
        }
        priorityDistribution[prio].total++;
        if (r.status === 'Passed') priorityDistribution[prio].passed++;
        else if (r.status === 'Failed') priorityDistribution[prio].failed++;
        else if (r.status === 'Skipped') priorityDistribution[prio].skipped++;
      });

      const detailedSeverityDistribution: Record<
        string,
        { passed: number; failed: number; skipped: number; total: number }
      > = {};
      testCaseResults.forEach((r) => {
        const sev = r.severity || 'N/A';
        if (!detailedSeverityDistribution[sev]) {
          detailedSeverityDistribution[sev] = { passed: 0, failed: 0, skipped: 0, total: 0 };
        }
        detailedSeverityDistribution[sev].total++;
        if (r.status === 'Passed') detailedSeverityDistribution[sev].passed++;
        else if (r.status === 'Failed') detailedSeverityDistribution[sev].failed++;
        else if (r.status === 'Skipped') detailedSeverityDistribution[sev].skipped++;
      });

      // 5. Detailed View of Failed Tests
      const failedTestDetails = testCaseResults
        .filter((r) => r.status === 'Failed')
        .map((r) => ({
          id: r.id,
          testName: r.testName,
          // Which browser this failure came from. A plan covering two browsers fails a test on
          // one and passes it on the other, and the two rows are otherwise identical.
          browser: r.browser,
          // Which version of the test this was. Null for a result recorded before versions were,
          // and for API tests, which have no history to point at.
          testVersion: r.testVersion,
          reasonForFailure: r.reasonForFailure,
          // In quarantine when it ran: shown, and not held against the run.
          quarantined: r.quarantined,
          // How many times the plan ran it before this result stood.
          attempts: r.attempts,
          // The issue this failure is already filed as, with the link to open it in the tracker.
          issue: issueFor(r),
          screenshotUrl: openable(r.screenshotUrl),
          // A recording of the run, and a trace of it, when the plan kept them. The trace is the
          // one that answers what a screenshot cannot: the DOM, the network and the console at
          // every step.
          videoUrl: openable(r.videoUrl),
          traceUrl: openable(r.traceUrl),
          // The page's requests: the file, and the failed and slow ones read out of it.
          harUrl: openable(r.harUrl),
          evidenceRestricted: evidenceRestricted(r),
          unitEvidence: unitEvidenceOf(r),
          networkSummary: r.networkSummary,
          // What the AI made of this failure, when somebody asked (routes/failure-analysis.routes.ts).
          aiAnalysis: r.aiAnalysis ?? null,
          detailedLog: r.detailedLog,
          // The step list the runner already recorded, with its images made openable. The
          // report had no way to show which step failed; the row's reason string was all of it.
          steps: stepsOf(r.detailedLog),
          component: r.component,
          priority: r.priority,
          severity: r.severity,
          durationMs: r.durationMs,
          uiTestId: r.uiTestId,
          apiTestId: r.apiTestId,
          testType: r.testType,
        }));

      // 6. Expandable Test Groupings (by module, then by component as an example)
      const groupedByModule: Record<
        string,
        {
          passed: number;
          failed: number;
          skipped: number;
          total: number;
          components: Record<
            string,
            {
              passed: number;
              failed: number;
              skipped: number;
              total: number;
              tests: Array<(typeof testCaseResults)[0]>; // Using the inferred type of elements in testCaseResults
            }
          >;
        }
      > = {};

      testCaseResults.forEach((r) => {
        const moduleName = r.module || 'Uncategorized Module';
        const componentName = r.component || 'Uncategorized Component';

        if (!groupedByModule[moduleName]) {
          groupedByModule[moduleName] = {
            passed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            components: {},
          };
        }
        if (!groupedByModule[moduleName].components[componentName]) {
          groupedByModule[moduleName].components[componentName] = {
            passed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            tests: [],
          };
        }

        groupedByModule[moduleName].total++;
        groupedByModule[moduleName].components[componentName].total++;
        // The row as stored, plus its steps and an openable screenshot: the grouped table is
        // where a passing test's visual baselines are looked at, not only a failing one's.
        groupedByModule[moduleName].components[componentName].tests.push({
          ...r,
          screenshotUrl: openable(r.screenshotUrl),
          videoUrl: openable(r.videoUrl),
          traceUrl: openable(r.traceUrl),
          harUrl: openable(r.harUrl),
          evidenceRestricted: evidenceRestricted(r),
          unitEvidence: unitEvidenceOf(r),
          steps: stepsOf(r.detailedLog),
        } as typeof r);

        if (r.status === 'Passed') {
          groupedByModule[moduleName].passed++;
          groupedByModule[moduleName].components[componentName].passed++;
        } else if (r.status === 'Failed') {
          groupedByModule[moduleName].failed++;
          groupedByModule[moduleName].components[componentName].failed++;
        } else if (r.status === 'Skipped') {
          groupedByModule[moduleName].skipped++;
          groupedByModule[moduleName].components[componentName].skipped++;
        }
      });

      const reportData = {
        header: {
          testSuiteName:
            readExecutionSnapshot(execution.configurationSnapshot)?.plan.name ||
            plan?.name ||
            'N/A',
          reproducibility: reproducibilitySummary(execution.configurationSnapshot),
          environment: execution.environment || 'N/A',
          // What the schedule asked for, else the browsers the results actually came from: a plan
          // run by hand records its browsers on each result, and the header said none.
          browsers: (() => {
            const requested =
              typeof execution.browsers === 'string'
                ? JSON.parse(execution.browsers)
                : (execution.browsers ?? []);
            if (Array.isArray(requested) && requested.length > 0) return requested;
            return Array.from(
              new Set(testCaseResults.map((r) => r.browser).filter((b): b is string => !!b)),
            );
          })(),
          // What the run could not do as asked, said where the verdict is read.
          warnings,
          dateTime: execution.startedAt ? execution.startedAt.toISOString() : 'N/A',
          completedAt: execution.completedAt ? execution.completedAt.toISOString() : null,
          status: execution.status,
          triggeredBy: execution.triggeredBy,
          // Which runner took it: where to look when one machine is the one that fails.
          runnerId: execution.runnerId ?? null,
          // The build, commit and branch that asked for it, when a pipeline did.
          ci: execution.ciContext ?? null,
          executionId: execution.id,
          testPlanId: execution.testPlanId,
          // Which attempt of its scheduled occurrence this run is, and where the others are.
          attempt: execution.attempt,
          maxAttempts: execution.maxAttempts,
          firstAttemptId: execution.retryOfExecutionId,
          nextAttempt,
          attempts: attemptHistory.map((a) => ({
            id: a.id,
            attempt: a.attempt,
            status: a.status,
            startedAt: a.startedAt ? a.startedAt.toISOString() : null,
            completedAt: a.completedAt ? a.completedAt.toISOString() : null,
          })),
          // Why a run ended the way it did when that was not its tests: cancelled, out of time,
          // its worker lost.
          failureCode: execution.failureCode,
          failureMessage: execution.failureMessage,
          // When retention removed this run's screenshots, videos and traces.
          artifactsPurgedAt: execution.artifactsPurgedAt
            ? execution.artifactsPurgedAt.toISOString()
            : null,
          artifactStorageStatus: execution.artifactStorageStatus,
          quotaDeferReason: execution.quotaDeferReason,
          quotaDeferUntil: execution.quotaDeferUntil,
          // Tests that passed only after being run again: a pass, and a finding of its own.
          flakyTests: testCaseResults.filter((r) => r.status === 'Passed' && (r.attempts ?? 1) > 1)
            .length,
          // Failures of tests in quarantine: counted in the failed figure, not in the verdict.
          quarantinedFailures: testCaseResults.filter(
            (r) => r.quarantined && (r.status === 'Failed' || r.status === 'Error'),
          ).length,
        },
        keyMetrics: {
          totalTests: execution.totalTests ?? totalTests, // Prefer pre-calculated, fallback to fresh calculation
          passedTests: execution.passedTests ?? passedTests,
          failedTests: execution.failedTests ?? failedTests,
          skippedTests: execution.skippedTests ?? skippedTests,
          passRate:
            (execution.totalTests ?? totalTests) > 0
              ? parseFloat(
                  (
                    ((execution.passedTests ?? passedTests) /
                      (execution.totalTests ?? totalTests)) *
                    100
                  ).toFixed(2),
                )
              : 0,
          averageTimePerTestMs: averageTimePerTest, // This needs fresh calculation from reportTestCaseResults
          totalTestCasesDurationMs: totalDurationMs, // Sum of individual test case durations
          executionDurationMs:
            execution.executionDurationMs ??
            (execution.completedAt && execution.startedAt
              ? new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
              : null),
        },
        charts: {
          passFailSkippedDistribution,
          priorityDistribution,
          severityDistribution: detailedSeverityDistribution,
        },
        failedTestDetails,
        testGroupings: groupedByModule,
        // Every row, with the same openable links as the rest of the report: the stored `/results/…`
        // paths are served by nothing and opened the application's own page instead of the file.
        allTests: testCaseResults.map((r) => ({
          ...r,
          screenshotUrl: openable(r.screenshotUrl),
          videoUrl: openable(r.videoUrl),
          traceUrl: openable(r.traceUrl),
          harUrl: openable(r.harUrl),
          evidenceRestricted: evidenceRestricted(r),
          issue: issueFor(r),
        })),
        issues: issues.map((issue) => ({
          key: issue.issueKey,
          url: issue.issueUrl,
          testName: issue.testName,
          browser: issue.browser,
          occurrences: issue.occurrences,
          resolvedAt: issue.resolvedAt,
        })),
      };

      res.json(reportData);
    } catch (error: any) {
      logger.error({
        message: `Error fetching report for execution ${executionId}`,
        error: error.message,
        stack: error.stack,
        userId,
      });
      res.status(500).json({ error: 'Failed to fetch test execution report.' });
    }
  },
);

/**
 * Stops a run.
 *
 * A run that started wrong — the wrong environment, a plan somebody is still editing — used to
 * run to its end, however long that was, holding a worker and a browser the whole time. One
 * still in the queue is cancelled at once (200); a running one is asked to stop (202) and its
 * worker ends it at its next step. Asking twice is harmless, and asking about a run that has
 * already finished says so rather than pretending to have stopped it.
 */
router.post('/api/test-plan-executions/:id/cancel', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });

  const who = (req.user as { username?: string }).username ?? `user ${req.user.id}`;
  const result = await requestCancellation(req.params.id, `Cancelled by ${who}.`, (tx, execution) =>
    recordAudit(tx, {
      action: AUDIT_ACTIONS.RUN_CANCELLED,
      actor: auditActor(req),
      targetType: 'run',
      targetId: execution.id,
      metadata: { planId: execution.testPlanId },
    }),
  );

  switch (result.outcome) {
    case 'not_found':
      return res.status(404).json({ error: 'Test plan execution not found.' });
    case 'already_ended':
      return res
        .status(409)
        .json({ error: `The run has already ended (${result.status}).`, status: result.status });
    case 'cancelled':
      logger.info({ message: 'Queued run cancelled', executionId: req.params.id, by: req.user.id });
      return res
        .status(200)
        .json({ status: 'cancelled', execution: publicExecution(result.execution) });
    case 'cancelling':
      logger.info({
        message: 'Running run asked to stop',
        executionId: req.params.id,
        by: req.user.id,
      });
      return res
        .status(202)
        .json({ status: 'cancelling', execution: publicExecution(result.execution) });
  }
});

export default router;
