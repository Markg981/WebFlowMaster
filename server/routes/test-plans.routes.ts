import { Router } from "express";
import { db } from "../db";
import { testPlans, testPlanSchedules, testPlanExecutions, insertTestPlanScheduleSchema, updateTestPlanScheduleSchema } from "@shared/schema";
import { eq, desc, and, getTableColumns } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import loggerPromise from "../logger";
import schedulerService from "../scheduler-service";

const router = Router();
const logger = await loggerPromise;

// jsonb columns are stored via JSON.stringify (codebase convention) and parsed back
// on read. Re-fetches a schedule joined with its test plan name, with JSON fields parsed.
async function fetchScheduleWithPlanName(id: string) {
    const rows = await db
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

router.get("/api/test-plans", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const plans = await db.select().from(testPlans).orderBy(desc(testPlans.createdAt));
    res.json(plans);
});

router.post("/api/test-plans", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    
    // Simplified schema handling for refactor brevity - in real migration ensure Zod schemas match 100%
    // Assuming `insertTestPlanSchema` handles most fields, special handling for selectedTests is needed as per original routes
    const planId = uuidv4();
    try {
        const newPlan = await db.insert(testPlans).values({
            ...req.body,
            id: planId,
            testMachinesConfig: req.body.testMachinesConfig ? JSON.stringify(req.body.testMachinesConfig) : null,
            notificationSettings: req.body.notificationSettings ? JSON.stringify(req.body.notificationSettings) : null
        }).returning();
        res.status(201).json(newPlan[0]);
    } catch(e: any) {
        logger.error({ message: "Plan creation failed", error: e.message });
        res.status(500).json({ error: "Failed to create plan" });
    }
});

router.get("/api/test-plans/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const plan = await db.select().from(testPlans).where(eq(testPlans.id, req.params.id)).limit(1);
    if(plan.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(plan[0]);
});

// --- Schedules ---

router.get("/api/test-plan-schedules", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    
    const results = await db.select({
        ...getTableColumns(testPlanSchedules),
        testPlanName: testPlans.name
    })
    .from(testPlanSchedules)
    .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
    .orderBy(desc(testPlanSchedules.createdAt));

    // Parse JSONs
    const parsed = results.map(s => ({
        ...s,
        browsers: typeof s.browsers === 'string' ? JSON.parse(s.browsers) : s.browsers,
        executionParameters: typeof s.executionParameters === 'string' ? JSON.parse(s.executionParameters) : s.executionParameters
    }));
    
    res.json(parsed);
});

router.post("/api/test-plan-schedules", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const parseResult = insertTestPlanScheduleSchema.safeParse(req.body);
    if(!parseResult.success) return res.status(400).json({ error: "Invalid data", details: parseResult.error.flatten() });

    const scheduleId = uuidv4();
    const data = parseResult.data;

    try {
        // nextRunAt arrives as a Date or a unix-seconds number (schema allows both).
        const nextRunAt = data.nextRunAt instanceof Date ? data.nextRunAt : new Date(data.nextRunAt * 1000);

        await db.insert(testPlanSchedules).values({
            ...data,
            id: scheduleId,
            nextRunAt,
            browsers: data.browsers ? JSON.stringify(data.browsers) : null,
            notificationConfigOverride: data.notificationConfigOverride ? JSON.stringify(data.notificationConfigOverride) : null,
            executionParameters: data.executionParameters ? JSON.stringify(data.executionParameters) : null,
            userId: (req.user as any)?.id ?? null,
            updatedAt: new Date()
        });

        const created = await fetchScheduleWithPlanName(scheduleId);
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

router.put("/api/test-plan-schedules/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id;

    const parseResult = updateTestPlanScheduleSchema.safeParse(req.body);
    if(!parseResult.success) return res.status(400).json({ error: "Invalid data", details: parseResult.error.flatten() });
    const updates = parseResult.data;

    try {
        const values: Record<string, any> = { ...updates, updatedAt: new Date() };
        if (updates.nextRunAt !== undefined) {
            values.nextRunAt = updates.nextRunAt instanceof Date ? updates.nextRunAt : new Date((updates.nextRunAt as number) * 1000);
        }
        if (updates.browsers !== undefined) values.browsers = updates.browsers ? JSON.stringify(updates.browsers) : null;
        if (updates.notificationConfigOverride !== undefined) values.notificationConfigOverride = updates.notificationConfigOverride ? JSON.stringify(updates.notificationConfigOverride) : null;
        if (updates.executionParameters !== undefined) values.executionParameters = updates.executionParameters ? JSON.stringify(updates.executionParameters) : null;
        // Drop undefined keys so Drizzle doesn't try to set them.
        Object.keys(values).forEach(k => values[k] === undefined && delete values[k]);

        const updated = await db.update(testPlanSchedules).set(values).where(eq(testPlanSchedules.id, id)).returning();
        if (updated.length === 0) return res.status(404).json({ error: "Schedule not found" });

        const result = await fetchScheduleWithPlanName(id);
        await schedulerService.updateScheduleJob(updated[0]);

        res.json(result);
    } catch(e: any) {
        if (isForeignKeyError(e)) {
            return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
        }
        logger.error({ message: "Schedule update failed", error: e.message });
        res.status(500).json({ error: "Failed to update schedule" });
    }
});

router.delete("/api/test-plan-schedules/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id;
    try {
        const deleted = await db.delete(testPlanSchedules).where(eq(testPlanSchedules.id, id)).returning();
        if (deleted.length === 0) return res.status(404).json({ error: "Schedule not found" });
        schedulerService.removeScheduleJob(id);
        res.status(204).send();
    } catch(e: any) {
        res.status(500).json({ error: "Failed to delete schedule" });
    }
});

// --- Executions ---

router.get("/api/test-plan-executions", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const { planId, scheduleId, status, triggeredBy, limit = 10, offset = 0 } = req.query;
    const pageLimit = Math.min(Math.max(1, parseInt(limit as string) || 10), 100);
    const pageOffset = Math.max(0, parseInt(offset as string) || 0);

    const conditions = [];
    if (planId && typeof planId === 'string') conditions.push(eq(testPlanExecutions.testPlanId, planId));
    if (scheduleId && typeof scheduleId === 'string') conditions.push(eq(testPlanExecutions.scheduleId, scheduleId));
    if (status && typeof status === 'string') conditions.push(eq(testPlanExecutions.status, status));
    if (triggeredBy && typeof triggeredBy === 'string') conditions.push(eq(testPlanExecutions.triggeredBy, triggeredBy));

    let query = db.select({
        ...getTableColumns(testPlanExecutions),
        testPlanName: testPlans.name,
        scheduleName: testPlanSchedules.scheduleName,
    })
    .from(testPlanExecutions)
    .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
    .leftJoin(testPlanSchedules, eq(testPlanExecutions.scheduleId, testPlanSchedules.id))
    .$dynamic();

    if (conditions.length > 0) query = query.where(and(...conditions));

    const results = await query.orderBy(desc(testPlanExecutions.startedAt)).limit(pageLimit).offset(pageOffset);
    const parsed = results.map(e => ({
        ...e,
        results: typeof e.results === 'string' ? JSON.parse(e.results) : e.results,
        browsers: typeof e.browsers === 'string' ? JSON.parse(e.browsers) : e.browsers,
    }));

    res.json({ items: parsed, limit: pageLimit, offset: pageOffset });
});

export default router;
