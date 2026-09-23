import { Router, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  AUDIT_ACTIONS,
  apiTests,
  tags,
  testPlanSuites,
  testPlans,
  testSuiteItems,
  testSuites,
  tests,
} from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId, type TenantTx } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { testsOfSuite } from "../test-suites";
import loggerPromise from "../logger";

/**
 * Suites, and which plans include them. The rules for what a suite runs are in
 * server/test-suites.ts; RLS keeps each organization's to itself, and a suite in a restricted
 * project to that project's members (migration 0034).
 */

const router = Router();
const logger = await loggerPromise;

class SuiteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const itemSchema = z.object({ type: z.enum(["ui", "api"]), id: z.number().int().positive() });

const suiteSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required").max(120),
    description: z.string().max(2000).nullable().optional(),
    kind: z.enum(["static", "dynamic"]),
    projectId: z.number().int().positive().nullable().optional(),
    tagIds: z.array(z.string().min(1)).max(20).optional(),
    items: z.array(itemSchema).max(1000).optional(),
  })
  .refine((suite) => suite.kind !== "dynamic" || (suite.tagIds?.length ?? 0) > 0, {
    message: "A dynamic suite needs at least one tag: with none it would match nothing.",
    path: ["tagIds"],
  });

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof SuiteError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error)?.message ?? "";
  if (/unique|duplicate/i.test(message)) return res.status(409).json({ error: "A suite with that name already exists." });
  // A project that does not exist or cannot be edited (migration 0031): one answer for both.
  if (/foreign key|row-level security/i.test(message)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
  logger.error({ message: `Failed to ${what}`, error: message });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

/** The tests and tags named must be this organization's and visible to the requester. */
async function checkReferences(tx: TenantTx, input: { items?: Array<{ type: "ui" | "api"; id: number }>; tagIds?: string[] }) {
  const uiIds = Array.from(new Set((input.items ?? []).filter((i) => i.type === "ui").map((i) => i.id)));
  const apiIds = Array.from(new Set((input.items ?? []).filter((i) => i.type === "api").map((i) => i.id)));
  if (uiIds.length && (await tx.select({ id: tests.id }).from(tests).where(inArray(tests.id, uiIds))).length !== uiIds.length) {
    throw new SuiteError(400, "One or more tests do not exist.");
  }
  if (apiIds.length && (await tx.select({ id: apiTests.id }).from(apiTests).where(inArray(apiTests.id, apiIds))).length !== apiIds.length) {
    throw new SuiteError(400, "One or more API tests do not exist.");
  }
  const tagIds = Array.from(new Set(input.tagIds ?? []));
  if (tagIds.length && (await tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds))).length !== tagIds.length) {
    throw new SuiteError(400, "One or more tags do not exist.");
  }
}

async function writeItems(tx: TenantTx, suiteId: number, organizationId: number, items: Array<{ type: "ui" | "api"; id: number }>) {
  await tx.delete(testSuiteItems).where(eq(testSuiteItems.suiteId, suiteId));
  // Each test once, in the order given.
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return;
  await tx.insert(testSuiteItems).values(
    unique.map((item, position) => ({
      organizationId,
      suiteId,
      testType: item.type,
      testId: item.type === "ui" ? item.id : null,
      apiTestId: item.type === "api" ? item.id : null,
      position,
    })),
  );
}

/** A suite as the pages show it: what it is, what it runs right now, which plans include it. */
async function describeSuite(tx: TenantTx, suiteId: number) {
  const [suite] = await tx.select().from(testSuites).where(eq(testSuites.id, suiteId)).limit(1);
  if (!suite) return null;
  const resolved = await testsOfSuite(tx, suite);
  const uiIds = resolved.filter((r) => r.testType === "ui").map((r) => r.testId!);
  const apiIds = resolved.filter((r) => r.testType === "api").map((r) => r.apiTestId!);
  // Names through RLS: a test in a project the requester cannot see is counted, not named.
  const uiNames = new Map(uiIds.length ? (await tx.select({ id: tests.id, name: tests.name }).from(tests).where(inArray(tests.id, uiIds))).map((t) => [t.id, t.name]) : []);
  const apiNames = new Map(apiIds.length ? (await tx.select({ id: apiTests.id, name: apiTests.name }).from(apiTests).where(inArray(apiTests.id, apiIds))).map((t) => [t.id, t.name]) : []);
  const plans = await tx
    .select({ id: testPlans.id, name: testPlans.name })
    .from(testPlanSuites)
    .innerJoin(testPlans, eq(testPlans.id, testPlanSuites.testPlanId))
    .where(eq(testPlanSuites.suiteId, suiteId))
    .orderBy(asc(testPlans.name));
  return {
    ...suite,
    tests: resolved.map((r) =>
      r.testType === "ui"
        ? { type: "ui" as const, id: r.testId!, name: uiNames.get(r.testId!) ?? null }
        : { type: "api" as const, id: r.apiTestId!, name: apiNames.get(r.apiTestId!) ?? null },
    ),
    plans,
  };
}

// GET /api/suites — every suite the requester can see, with how many tests it has now.
router.get("/api/suites", requireRole("viewer"), async (_req, res) => {
  try {
    const rows = await withTenantTransaction(async (tx) => {
      const suites = await tx.select().from(testSuites).orderBy(asc(testSuites.name));
      const planCounts = await tx
        .select({ suiteId: testPlanSuites.suiteId, plans: sql<number>`count(*)` })
        .from(testPlanSuites)
        .groupBy(testPlanSuites.suiteId);
      const plansOf = new Map(planCounts.map((row) => [row.suiteId, Number(row.plans)]));
      return Promise.all(
        suites.map(async (suite) => ({ ...suite, testCount: (await testsOfSuite(tx, suite)).length, planCount: plansOf.get(suite.id) ?? 0 })),
      );
    });
    res.json(rows);
  } catch (error) {
    fail(res, error, "load the suites");
  }
});

router.get("/api/suites/:id", requireRole("viewer"), async (req, res) => {
  const suiteId = Number(req.params.id);
  if (!Number.isInteger(suiteId)) return res.status(400).json({ error: "Invalid suite id" });
  try {
    const suite = await withTenantTransaction((tx) => describeSuite(tx, suiteId));
    if (!suite) return res.status(404).json({ error: "Suite not found" });
    res.json(suite);
  } catch (error) {
    fail(res, error, "load the suite");
  }
});

router.post("/api/suites", requireRole("editor"), async (req, res) => {
  const parsed = suiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid suite", details: parsed.error.flatten() });
  const organizationId = getTenantOrgId()!;
  const input = parsed.data;
  try {
    const created = await withTenantTransaction(async (tx) => {
      await checkReferences(tx, input);
      const [suite] = await tx
        .insert(testSuites)
        .values({
          organizationId,
          name: input.name,
          description: input.description ?? null,
          kind: input.kind,
          projectId: input.projectId ?? null,
          tagIds: input.kind === "dynamic" ? input.tagIds ?? [] : [],
          createdBy: req.user!.id,
        })
        .returning();
      if (input.kind === "static") await writeItems(tx, suite.id, organizationId, input.items ?? []);
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SUITE_CREATED,
        actor: auditActor(req),
        targetType: "suite",
        targetId: suite.id,
        metadata: { name: suite.name, kind: suite.kind },
      });
      return describeSuite(tx, suite.id);
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "create the suite");
  }
});

router.put("/api/suites/:id", requireRole("editor"), async (req, res) => {
  const suiteId = Number(req.params.id);
  const parsed = suiteSchema.safeParse(req.body);
  if (!Number.isInteger(suiteId) || !parsed.success) {
    return res.status(400).json({ error: "Invalid suite", details: parsed.success ? undefined : parsed.error.flatten() });
  }
  const organizationId = getTenantOrgId()!;
  const input = parsed.data;
  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [existing] = await tx.select().from(testSuites).where(eq(testSuites.id, suiteId)).limit(1);
      if (!existing) throw new SuiteError(404, "Suite not found");
      await checkReferences(tx, input);
      const rows = await tx
        .update(testSuites)
        .set({
          name: input.name,
          description: input.description ?? null,
          kind: input.kind,
          projectId: input.projectId ?? null,
          tagIds: input.kind === "dynamic" ? input.tagIds ?? [] : [],
          updatedAt: new Date(),
        })
        .where(eq(testSuites.id, suiteId))
        .returning();
      // Visible but not changed: the requester is a viewer on the suite's restricted project.
      if (rows.length === 0) throw new SuiteError(403, "You can view this suite's project but not change it.");
      await writeItems(tx, suiteId, organizationId, input.kind === "static" ? input.items ?? [] : []);
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SUITE_UPDATED,
        actor: auditActor(req),
        targetType: "suite",
        targetId: suiteId,
        metadata: { name: input.name, kind: input.kind, ...(existing.name !== input.name ? { renamedFrom: existing.name } : {}) },
      });
      return describeSuite(tx, suiteId);
    });
    res.json(updated);
  } catch (error) {
    fail(res, error, "update the suite");
  }
});

// DELETE /api/suites/:id — plans that included it simply stop including it.
router.delete("/api/suites/:id", requireRole("editor"), async (req, res) => {
  const suiteId = Number(req.params.id);
  if (!Number.isInteger(suiteId)) return res.status(400).json({ error: "Invalid suite id" });
  try {
    await withTenantTransaction(async (tx) => {
      const [existing] = await tx.select().from(testSuites).where(eq(testSuites.id, suiteId)).limit(1);
      if (!existing) throw new SuiteError(404, "Suite not found");
      const plans = await tx.select({ planId: testPlanSuites.testPlanId }).from(testPlanSuites).where(eq(testPlanSuites.suiteId, suiteId));
      const deleted = await tx.delete(testSuites).where(eq(testSuites.id, suiteId)).returning();
      if (deleted.length === 0) throw new SuiteError(403, "You can view this suite's project but not change it.");
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SUITE_DELETED,
        actor: auditActor(req),
        targetType: "suite",
        targetId: suiteId,
        metadata: { name: existing.name, removedFromPlans: plans.map((p) => p.planId) },
      });
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error, "delete the suite");
  }
});

// GET /api/test-plans/:id/suites — the suites a plan includes, in order.
router.get("/api/test-plans/:id/suites", requireRole("viewer"), async (req, res) => {
  try {
    const rows = await withTenantTransaction(async (tx) => {
      const [plan] = await tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, req.params.id)).limit(1);
      if (!plan) throw new SuiteError(404, "Test plan not found");
      return tx
        .select({ id: testSuites.id, name: testSuites.name, kind: testSuites.kind, position: testPlanSuites.position })
        .from(testPlanSuites)
        .innerJoin(testSuites, eq(testSuites.id, testPlanSuites.suiteId))
        .where(eq(testPlanSuites.testPlanId, plan.id))
        .orderBy(asc(testPlanSuites.position));
    });
    res.json(rows);
  } catch (error) {
    fail(res, error, "load the plan's suites");
  }
});

// PUT /api/test-plans/:id/suites — replace them: { suiteIds: [3, 1] } runs 3 then 1.
router.put("/api/test-plans/:id/suites", requireRole("editor"), async (req, res) => {
  const parsed = z.object({ suiteIds: z.array(z.number().int().positive()).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const suiteIds = Array.from(new Set(parsed.data.suiteIds));
  const organizationId = getTenantOrgId()!;
  try {
    const rows = await withTenantTransaction(async (tx) => {
      const [plan] = await tx.select({ id: testPlans.id, name: testPlans.name }).from(testPlans).where(eq(testPlans.id, req.params.id)).limit(1);
      if (!plan) throw new SuiteError(404, "Test plan not found");
      const found = suiteIds.length ? await tx.select({ id: testSuites.id, name: testSuites.name }).from(testSuites).where(inArray(testSuites.id, suiteIds)) : [];
      if (found.length !== suiteIds.length) throw new SuiteError(400, "One or more suites do not exist.");
      await tx.delete(testPlanSuites).where(eq(testPlanSuites.testPlanId, plan.id));
      if (suiteIds.length) {
        await tx.insert(testPlanSuites).values(suiteIds.map((suiteId, position) => ({ testPlanId: plan.id, suiteId, organizationId, position })));
      }
      const nameOf = new Map(found.map((s) => [s.id, s.name]));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.PLAN_SUITES_CHANGED,
        actor: auditActor(req),
        targetType: "test_plan",
        targetId: plan.id,
        metadata: { name: plan.name, suites: suiteIds.map((id) => nameOf.get(id)) },
      });
      return tx
        .select({ id: testSuites.id, name: testSuites.name, kind: testSuites.kind, position: testPlanSuites.position })
        .from(testPlanSuites)
        .innerJoin(testSuites, eq(testSuites.id, testPlanSuites.suiteId))
        .where(and(eq(testPlanSuites.testPlanId, plan.id)))
        .orderBy(asc(testPlanSuites.position));
    });
    res.json(rows);
  } catch (error) {
    fail(res, error, "change the plan's suites");
  }
});

export default router;
