import { Router, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  AUDIT_ACTIONS,
  apiTests,
  impactRules,
  mobileTests,
  tags,
  testPlans,
  testPlanSelectedTests,
  tests,
} from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId, withTenantTransaction } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { MAX_CHANGED_FILES, selectForChanges, validatePattern } from "../test-impact";
import { expandPlanTests, type TestReference } from "../test-suites";
import loggerPromise from "../logger";

/**
 * The impact map (server/test-impact.ts): which file patterns map to which tests' tags. Viewers
 * read it and try it on a list of files; editors keep it.
 */

const router = Router();

class ImpactError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function fail(res: Response, error: unknown, doing: string) {
  if (error instanceof ImpactError) return res.status(error.status).json({ error: error.message });
  const logger = await loggerPromise;
  logger.error({ message: `Could not ${doing}`, error: (error as Error)?.message });
  res.status(500).json({ error: `Could not ${doing}.` });
}

router.get("/api/impact-rules", requireRole("viewer"), async (_req, res) => {
  try {
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({ id: impactRules.id, pattern: impactRules.pattern, tagId: impactRules.tagId, tagName: tags.name, createdAt: impactRules.createdAt })
        .from(impactRules)
        .leftJoin(tags, eq(tags.id, impactRules.tagId))
        .orderBy(asc(impactRules.pattern), asc(tags.name)),
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, "list the impact map");
  }
});

const ruleSchema = z.object({
  pattern: z.string().max(300),
  /** Null: the files affect no test. */
  tagId: z.string().min(1).nullable(),
});

router.post("/api/impact-rules", requireRole("editor"), async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Expected a pattern and a tag (or none)." });
  const pattern = parsed.data.pattern.trim();
  const invalid = validatePattern(pattern);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const created = await withTenantTransaction(async (tx) => {
      let tagName: string | null = null;
      if (parsed.data.tagId) {
        // Under RLS: another organization's tag is not found.
        const [tag] = await tx.select({ name: tags.name }).from(tags).where(eq(tags.id, parsed.data.tagId)).limit(1);
        if (!tag) throw new ImpactError(400, "No such tag.");
        tagName = tag.name;
      }
      const [same] = await tx
        .select({ id: impactRules.id })
        .from(impactRules)
        .where(and(eq(impactRules.pattern, pattern), parsed.data.tagId ? eq(impactRules.tagId, parsed.data.tagId) : isNull(impactRules.tagId)))
        .limit(1);
      if (same) throw new ImpactError(409, "That rule already exists.");
      const [row] = await tx
        .insert(impactRules)
        .values({ id: uuidv4(), organizationId: getTenantOrgId()!, pattern, tagId: parsed.data.tagId })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.IMPACT_RULE_CREATED,
        actor: auditActor(req),
        targetType: "impact_rule",
        targetId: row.id,
        metadata: { pattern, tag: tagName },
      });
      return { ...row, tagName };
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "add the rule");
  }
});

router.delete("/api/impact-rules/:id", requireRole("editor"), async (req, res) => {
  try {
    await withTenantTransaction(async (tx) => {
      const [row] = await tx.delete(impactRules).where(eq(impactRules.id, req.params.id)).returning();
      if (!row) throw new ImpactError(404, "Rule not found.");
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.IMPACT_RULE_DELETED,
        actor: auditActor(req),
        targetType: "impact_rule",
        targetId: row.id,
        metadata: { pattern: row.pattern },
      });
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error, "remove the rule");
  }
});

const previewSchema = z.object({
  planId: z.string().min(1),
  changedFiles: z.array(z.string().min(1).max(1000)).max(MAX_CHANGED_FILES),
});

/** Which of a plan's tests a list of changed files would run, without running anything. */
router.post("/api/impact-rules/preview", requireRole("viewer"), async (req, res) => {
  const parsed = previewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Expected a plan and a list of changed files." });
  try {
    const result = await withTenantTransaction(async (tx) => {
      const [plan] = await tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, parsed.data.planId)).limit(1);
      if (!plan) throw new ImpactError(404, "Test plan not found.");
      const direct = await tx
        .select({ testType: testPlanSelectedTests.testType, testId: testPlanSelectedTests.testId, apiTestId: testPlanSelectedTests.apiTestId, mobileTestId: testPlanSelectedTests.mobileTestId })
        .from(testPlanSelectedTests)
        .where(eq(testPlanSelectedTests.testPlanId, plan.id))
        .orderBy(asc(testPlanSelectedTests.id));
      const expanded = await expandPlanTests(tx, plan.id, direct as TestReference[]);
      const { refs, selection } = await selectForChanges(tx, plan.id, expanded, parsed.data.changedFiles);
      const ids = (type: string, field: "testId" | "apiTestId" | "mobileTestId") =>
        refs.filter((r) => r.testType === type && r[field]).map((r) => r[field] as number);
      const [ui, api, mobile] = await Promise.all([
        ids("ui", "testId").length ? tx.select({ id: tests.id, name: tests.name }).from(tests).where(inArray(tests.id, ids("ui", "testId"))) : [],
        ids("api", "apiTestId").length ? tx.select({ id: apiTests.id, name: apiTests.name }).from(apiTests).where(inArray(apiTests.id, ids("api", "apiTestId"))) : [],
        ids("mobile", "mobileTestId").length ? tx.select({ id: mobileTests.id, name: mobileTests.name }).from(mobileTests).where(inArray(mobileTests.id, ids("mobile", "mobileTestId"))) : [],
      ]);
      const names = new Map<string, string>([
        ...ui.map((t) => [`ui:${t.id}`, t.name] as [string, string]),
        ...api.map((t) => [`api:${t.id}`, t.name] as [string, string]),
        ...mobile.map((t) => [`mobile:${t.id}`, t.name] as [string, string]),
      ]);
      return {
        selection,
        tests: refs.map((r) => {
          const key = r.testType === "ui" ? `ui:${r.testId}` : r.testType === "api" ? `api:${r.apiTestId}` : `mobile:${r.mobileTestId}`;
          return { type: r.testType, name: names.get(key) ?? key };
        }),
      };
    });
    res.json(result);
  } catch (error) {
    fail(res, error, "work out the affected tests");
  }
});

export default router;
