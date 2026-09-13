import { Router } from "express";
import { testPlans, testPlanSchedules, testPlanExecutions, testPlanSelectedTests, insertTestPlanScheduleSchema, updateTestPlanScheduleSchema, testPlanApiPayloadSchema, type TestPlanSchedule } from "@shared/schema";
import { eq, desc, and, getTableColumns, type SQL } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import loggerPromise from "../logger";
import schedulerService, { assertValidTimezone } from "../scheduler-service";
import { withTenantTransaction, type TenantTx } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { assertSelectedTestsBelongTo, SELECTED_TESTS_NOT_FOUND } from "./selected-tests";

const router = Router();
const logger = await loggerPromise;

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
        notificationConfigOverride: typeof s.notificationConfigOverride === 'string' ? JSON.parse(s.notificationConfigOverride) : s.notificationConfigOverride,
        executionParameters: typeof s.executionParameters === 'string' ? JSON.parse(s.executionParameters) : s.executionParameters,
    };
}

function isForeignKeyError(e: any): boolean {
    return !!e?.message && e.message.toLowerCase().includes('foreign key');
}

// --- Test Plans ---

router.get("/api/test-plans", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    // No organization filter here on purpose: the RLS policy applies it.
    const plans = await withTenantTransaction((tx) =>
      tx.select().from(testPlans).orderBy(desc(testPlans.createdAt)),
    );
    res.json(plans);
});

router.post("/api/test-plans", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

    const parseResult = testPlanApiPayloadSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: "Invalid data", details: parseResult.error.flatten() });

    // selectedTests lives in a separate join table (testPlanSelectedTests) rather than as a
    // column on testPlans, so it is inserted separately below — not dropped. It used to be
    // destructured away and discarded here, which meant every plan created from the UI had
    // zero linked tests: CreateTestPlanWizard always sends this field.
    const { selectedTests, ...planData } = parseResult.data;

    const planId = uuidv4();
    try {
        const newPlan = await withTenantTransaction(async (tx) => {
          const inserted = await tx.insert(testPlans).values({
            ...planData,
            id: planId,
            // The tenancy boundary: always derived from the authenticated session, never
            // trusted from the request body (testPlanApiPayloadSchema omits both fields).
            userId: req.user!.id,
            organizationId: req.user!.organizationId,
            testMachinesConfig: planData.testMachinesConfig ? JSON.stringify(planData.testMachinesConfig) : null,
            notificationSettings: planData.notificationSettings ? JSON.stringify(planData.notificationSettings) : null
          }).returning();

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
                testType: st.type,
              })),
            );
          }

          return mainPlan;
        });
        res.status(201).json(newPlan);
    } catch(e: any) {
        // Either the DB rejected an id that does not exist at all, or the check above rejected
        // one that exists in another organization. Both are the caller naming a test that is
        // not theirs to name, and both answer the same way — a distinct message for the second
        // would tell them which ids exist in other tenants.
        if (SELECTED_TESTS_NOT_FOUND.test(e.message || '') || isForeignKeyError(e)) {
            return res.status(400).json({ error: "One or more selected tests do not exist." });
        }
        logger.error({ message: "Plan creation failed", error: e.message });
        res.status(500).json({ error: "Failed to create plan" });
    }
});

router.get("/api/test-plans/:id", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const plan = await withTenantTransaction((tx) =>
      tx.select().from(testPlans).where(eq(testPlans.id, req.params.id)).limit(1),
    );
    if(plan.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(plan[0]);
});

// --- Schedules ---

router.get("/api/test-plan-schedules", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    // No organization filter here on purpose: the RLS policy applies it.
    const results = await withTenantTransaction((tx) =>
      tx.select({
        ...getTableColumns(testPlanSchedules),
        testPlanName: testPlans.name
      })
      .from(testPlanSchedules)
      .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
      .orderBy(desc(testPlanSchedules.createdAt)),
    );

    // Parse JSONs
    const parsed = results.map(s => ({
        ...s,
        browsers: typeof s.browsers === 'string' ? JSON.parse(s.browsers) : s.browsers,
        executionParameters: typeof s.executionParameters === 'string' ? JSON.parse(s.executionParameters) : s.executionParameters
    }));

    res.json(parsed);
});

router.post("/api/test-plan-schedules", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const parseResult = insertTestPlanScheduleSchema.safeParse(req.body);
    if(!parseResult.success) return res.status(400).json({ error: "Invalid data", details: parseResult.error.flatten() });

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

        // nextRunAt arrives as a Date or a unix-seconds number (schema allows both).
        const nextRunAt = data.nextRunAt instanceof Date ? data.nextRunAt : new Date(data.nextRunAt * 1000);

        const created = await withTenantTransaction(async (tx) => {
          await tx.insert(testPlanSchedules).values({
              ...data,
              id: scheduleId,
              nextRunAt,
              browsers: data.browsers ? JSON.stringify(data.browsers) : null,
              notificationConfigOverride: data.notificationConfigOverride ? JSON.stringify(data.notificationConfigOverride) : null,
              executionParameters: data.executionParameters ? JSON.stringify(data.executionParameters) : null,
              userId: (req.user as any)?.id ?? null,
              organizationId: (req.user as { organizationId: number }).organizationId,
              updatedAt: new Date()
          });

          return fetchScheduleWithPlanName(tx, scheduleId);
        });
        // Add to scheduler
        await schedulerService.addScheduleJob(created as any);

        res.status(201).json(created);
    } catch(e: any) {
        if (isForeignKeyError(e)) {
            return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
        }
        logger.error({ message: "Schedule creation failed", error: e.message });
        res.status(500).json({ error: "Failed to create schedule" });
    }
});

router.put("/api/test-plan-schedules/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id;

    const parseResult = updateTestPlanScheduleSchema.safeParse(req.body);
    if(!parseResult.success) return res.status(400).json({ error: "Invalid data", details: parseResult.error.flatten() });
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
            values.nextRunAt = updates.nextRunAt instanceof Date ? updates.nextRunAt : new Date((updates.nextRunAt as number) * 1000);
        }
        if (updates.browsers !== undefined) values.browsers = updates.browsers ? JSON.stringify(updates.browsers) : null;
        if (updates.notificationConfigOverride !== undefined) values.notificationConfigOverride = updates.notificationConfigOverride ? JSON.stringify(updates.notificationConfigOverride) : null;
        if (updates.executionParameters !== undefined) values.executionParameters = updates.executionParameters ? JSON.stringify(updates.executionParameters) : null;
        // Drop undefined keys so Drizzle doesn't try to set them.
        Object.keys(values).forEach(k => values[k] === undefined && delete values[k]);

        // Under RLS this matches nothing for another organization's schedule (closing the
        // ownership gap this handler used to have — an id from any tenant reached this
        // query with no organization filter at all), so the 404 below is the correct
        // answer rather than a cross-tenant write.
        let updatedRow: TestPlanSchedule | undefined;
        const result = await withTenantTransaction(async (tx) => {
          const updated = await tx.update(testPlanSchedules).set(values).where(eq(testPlanSchedules.id, id)).returning();
          if (updated.length === 0) return null;

          updatedRow = updated[0];
          return fetchScheduleWithPlanName(tx, id);
        });
        if (result === null) return res.status(404).json({ error: "Schedule not found" });

        // Outside the transaction, like the sibling POST above: updateScheduleJob reaches
        // scheduler-service.ts, which issues its own privilegedDb.select(). A second query on
        // the handle while this transaction still holds the connection deadlocks the shared
        // PGlite client under dev/test and, under node-postgres, takes a second pool client
        // and runs outside RLS as superuser.
        await schedulerService.updateScheduleJob(updatedRow!);

        res.json(result);
    } catch(e: any) {
        if (isForeignKeyError(e)) {
            return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
        }
        logger.error({ message: "Schedule update failed", error: e.message });
        res.status(500).json({ error: "Failed to update schedule" });
    }
});

router.delete("/api/test-plan-schedules/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id;
    try {
        const deleted = await withTenantTransaction((tx) =>
          tx.delete(testPlanSchedules).where(eq(testPlanSchedules.id, id)).returning(),
        );
        if (deleted.length === 0) return res.status(404).json({ error: "Schedule not found" });
        schedulerService.removeScheduleJob(id);
        res.status(204).send();
    } catch(e: any) {
        res.status(500).json({ error: "Failed to delete schedule" });
    }
});

// --- Executions ---

router.get("/api/test-plan-executions", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const { planId, scheduleId, status, triggeredBy, limit = 10, offset = 0 } = req.query;
    const pageLimit = Math.min(Math.max(1, parseInt(limit as string) || 10), 100);
    const pageOffset = Math.max(0, parseInt(offset as string) || 0);

    // Explicitly typed: an empty-initialized array captured by the withTenantTransaction
    // closure below loses TypeScript's "evolving any[]" inference (that inference only
    // tracks assignments within the declaring function, not through a nested closure).
    const conditions: SQL[] = [];
    if (planId && typeof planId === 'string') conditions.push(eq(testPlanExecutions.testPlanId, planId));
    if (scheduleId && typeof scheduleId === 'string') conditions.push(eq(testPlanExecutions.scheduleId, scheduleId));
    if (status && typeof status === 'string') conditions.push(eq(testPlanExecutions.status, status));
    if (triggeredBy && typeof triggeredBy === 'string') conditions.push(eq(testPlanExecutions.triggeredBy, triggeredBy));

    // No organization filter here on purpose: the RLS policy applies it.
    const results = await withTenantTransaction((tx) => {
      let query = tx.select({
          ...getTableColumns(testPlanExecutions),
          testPlanName: testPlans.name,
          scheduleName: testPlanSchedules.scheduleName,
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .leftJoin(testPlanSchedules, eq(testPlanExecutions.scheduleId, testPlanSchedules.id))
      .$dynamic();

      if (conditions.length > 0) query = query.where(and(...conditions));

      return query.orderBy(desc(testPlanExecutions.startedAt)).limit(pageLimit).offset(pageOffset);
    });
    const parsed = results.map(e => ({
        ...e,
        results: typeof e.results === 'string' ? JSON.parse(e.results) : e.results,
        browsers: typeof e.browsers === 'string' ? JSON.parse(e.browsers) : e.browsers,
    }));

    res.json({ items: parsed, limit: pageLimit, offset: pageOffset });
});

export default router;
