import { Router, type Response } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { AUDIT_ACTIONS, apiTests, issueTrackers, requirementTests, requirements, tests } from "@shared/schema";
import { REQUIREMENT_KEY_PATTERN, REQUIREMENT_KINDS } from "@shared/requirements";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId, type TenantTx } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { fetchItems, MAX_IMPORTED_ITEMS, type TrackedItem } from "../issue-providers";
import { toConfig } from "../issue-store";
import { describeScope, loadCoverage, matrixCsv, upsertTrackedItems, wouldLoop, type CoverageScope } from "../requirements";
import loggerPromise from "../logger";

/**
 * Requirements traceability (shared/requirements.ts): epics, user stories and requirements, the
 * tests that cover them, and their coverage from the tests' latest results. Imports read the
 * organization's Jira or Azure DevOps through its issue tracker; nothing is written back there.
 */

const router = Router();
const logger = await loggerPromise;

class RequirementError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof RequirementError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error)?.message ?? "";
  if (/unique|duplicate/i.test(message)) return res.status(409).json({ error: "A requirement with that key already exists." });
  logger.error({ message: `Failed to ${what}`, error: message });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

const keySchema = z
  .string()
  .trim()
  .regex(REQUIREMENT_KEY_PATTERN, "A key is letters, digits, dots, dashes and underscores, like SHOP-142 or REQ_12.");

const requirementSchema = z.object({
  key: keySchema,
  title: z.string().trim().min(1, "A title is required").max(500),
  description: z.string().max(5000).nullable().optional(),
  kind: z.enum(REQUIREMENT_KINDS),
  parentId: z.number().int().positive().nullable().optional(),
});

const itemsSchema = z.object({
  items: z.array(z.object({ type: z.enum(["ui", "api"]), id: z.number().int().positive() })).max(1000),
});

const importSchema = z.object({
  trackerId: z.string().min(1),
  keys: z.array(keySchema).max(MAX_IMPORTED_ITEMS).optional(),
  query: z.string().trim().max(2000).optional(),
});

function scopeOf(query: Record<string, unknown>): CoverageScope {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { planId: text(query.planId), executionId: text(query.executionId) };
}

async function checkParent(tx: TenantTx, id: number | null, parentId: number | null | undefined) {
  if (parentId == null) return;
  const [parent] = await tx.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, parentId)).limit(1);
  if (!parent) throw new RequirementError(400, "The parent requirement does not exist.");
  if (id != null && (parentId === id || (await wouldLoop(tx, id, parentId)))) {
    throw new RequirementError(400, "A requirement cannot be under itself or under one of its own children.");
  }
}

/** The tests linked to this requirement itself, named when the requester can see them. */
async function linkedTests(tx: TenantTx, requirementId: number) {
  const links = await tx.select().from(requirementTests).where(eq(requirementTests.requirementId, requirementId));
  const uiIds = links.filter((l) => l.testType === "ui").map((l) => l.testId!);
  const apiIds = links.filter((l) => l.testType === "api").map((l) => l.apiTestId!);
  const uiNames = new Map(uiIds.length ? (await tx.select({ id: tests.id, name: tests.name }).from(tests).where(inArray(tests.id, uiIds))).map((t) => [t.id, t.name]) : []);
  const apiNames = new Map(apiIds.length ? (await tx.select({ id: apiTests.id, name: apiTests.name }).from(apiTests).where(inArray(apiTests.id, apiIds))).map((t) => [t.id, t.name]) : []);
  return links.map((l) =>
    l.testType === "ui"
      ? { type: "ui" as const, id: l.testId!, name: uiNames.get(l.testId!) ?? null }
      : { type: "api" as const, id: l.apiTestId!, name: apiNames.get(l.apiTestId!) ?? null },
  );
}

// GET /api/requirements — every requirement with its coverage; ?planId= or ?executionId= narrows
// the results that count to one plan's latest run or to exactly one run.
router.get("/api/requirements", requireRole("viewer"), async (req, res) => {
  const scope = scopeOf(req.query);
  try {
    const answer = await withTenantTransaction(async (tx) => {
      const described = await describeScope(tx, scope);
      if (described === undefined) throw new RequirementError(404, scope.executionId ? "Run not found." : "Test plan not found.");
      const trackers = await tx.select({ id: issueTrackers.id, name: issueTrackers.name, provider: issueTrackers.provider }).from(issueTrackers);
      return { ...(await loadCoverage(tx, scope)), scope: described, trackers };
    });
    res.json(answer);
  } catch (error) {
    fail(res, error, "load the requirements");
  }
});

// GET /api/requirements/matrix.csv — the traceability matrix, same scope as above.
router.get("/api/requirements/matrix.csv", requireRole("viewer"), async (req, res) => {
  const scope = scopeOf(req.query);
  try {
    const rows = await withTenantTransaction(async (tx) => {
      if ((await describeScope(tx, scope)) === undefined) throw new RequirementError(404, "Test plan or run not found.");
      return (await loadCoverage(tx, scope)).requirements;
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="traceability-matrix.csv"`);
    // The byte-order mark makes Excel read the file as UTF-8, accents included.
    res.send("﻿" + matrixCsv(rows));
  } catch (error) {
    fail(res, error, "export the matrix");
  }
});

router.get("/api/requirements/:id", requireRole("viewer"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid requirement id" });
  try {
    const found = await withTenantTransaction(async (tx) => {
      const [row] = await tx.select().from(requirements).where(eq(requirements.id, id)).limit(1);
      return row ? { ...row, tests: await linkedTests(tx, id) } : null;
    });
    if (!found) return res.status(404).json({ error: "Requirement not found" });
    res.json(found);
  } catch (error) {
    fail(res, error, "load the requirement");
  }
});

router.post("/api/requirements", requireRole("editor"), async (req, res) => {
  const parsed = requirementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid requirement", details: parsed.error.flatten() });
  const input = parsed.data;
  try {
    const created = await withTenantTransaction(async (tx) => {
      await checkParent(tx, null, input.parentId);
      const [row] = await tx
        .insert(requirements)
        .values({
          organizationId: getTenantOrgId()!,
          key: input.key,
          title: input.title,
          description: input.description ?? null,
          kind: input.kind,
          parentId: input.parentId ?? null,
          createdBy: req.user!.id,
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.REQUIREMENT_CREATED,
        actor: auditActor(req),
        targetType: "requirement",
        targetId: row.id,
        metadata: { key: row.key, kind: row.kind },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "create the requirement");
  }
});

router.put("/api/requirements/:id", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = requirementSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    return res.status(400).json({ error: parsed.success ? "Invalid requirement id" : parsed.error.issues[0]?.message, details: parsed.success ? undefined : parsed.error.flatten() });
  }
  const input = parsed.data;
  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [existing] = await tx.select().from(requirements).where(eq(requirements.id, id)).limit(1);
      if (!existing) throw new RequirementError(404, "Requirement not found");
      await checkParent(tx, id, input.parentId);
      const [row] = await tx
        .update(requirements)
        .set({ key: input.key, title: input.title, description: input.description ?? null, kind: input.kind, parentId: input.parentId ?? null, updatedAt: new Date() })
        .where(eq(requirements.id, id))
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.REQUIREMENT_UPDATED,
        actor: auditActor(req),
        targetType: "requirement",
        targetId: id,
        metadata: { key: row.key, ...(existing.key !== row.key ? { renamedFrom: existing.key } : {}) },
      });
      return row;
    });
    res.json(updated);
  } catch (error) {
    fail(res, error, "update the requirement");
  }
});

// PUT /api/requirements/:id/tests — the tests linked to it: { items: [{ type: 'ui', id: 12 }] }.
// Links to tests the requester cannot see are kept as they are: nobody removes what they cannot see.
router.put("/api/requirements/:id/tests", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = itemsSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const wanted = new Set(parsed.data.items.map((i) => `${i.type}:${i.id}`));
  try {
    const result = await withTenantTransaction(async (tx) => {
      const [requirement] = await tx.select().from(requirements).where(eq(requirements.id, id)).limit(1);
      if (!requirement) throw new RequirementError(404, "Requirement not found");

      const uiIds = parsed.data.items.filter((i) => i.type === "ui").map((i) => i.id);
      const apiIds = parsed.data.items.filter((i) => i.type === "api").map((i) => i.id);
      if (uiIds.length && (await tx.select({ id: tests.id }).from(tests).where(inArray(tests.id, uiIds))).length !== new Set(uiIds).size) {
        throw new RequirementError(400, "One or more tests do not exist.");
      }
      if (apiIds.length && (await tx.select({ id: apiTests.id }).from(apiTests).where(inArray(apiTests.id, apiIds))).length !== new Set(apiIds).size) {
        throw new RequirementError(400, "One or more API tests do not exist.");
      }

      const current = await linkedTests(tx, id);
      const have = new Set(current.map((t) => `${t.type}:${t.id}`));
      const removed = current.filter((t) => t.name !== null && !wanted.has(`${t.type}:${t.id}`));
      for (const test of removed) {
        await tx
          .delete(requirementTests)
          .where(
            and(
              eq(requirementTests.requirementId, id),
              test.type === "ui" ? eq(requirementTests.testId, test.id) : eq(requirementTests.apiTestId, test.id),
            ),
          );
      }
      const added = parsed.data.items.filter((i, index, all) => !have.has(`${i.type}:${i.id}`) && all.findIndex((o) => o.type === i.type && o.id === i.id) === index);
      if (added.length) {
        await tx.insert(requirementTests).values(
          added.map((item) => ({
            organizationId: getTenantOrgId()!,
            requirementId: id,
            testType: item.type,
            testId: item.type === "ui" ? item.id : null,
            apiTestId: item.type === "api" ? item.id : null,
            createdBy: req.user!.id,
          })),
        );
      }
      if (added.length || removed.length) {
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.REQUIREMENT_TESTS_CHANGED,
          actor: auditActor(req),
          targetType: "requirement",
          targetId: id,
          metadata: { key: requirement.key, added: added.map((i) => `${i.type}:${i.id}`), removed: removed.map((t) => `${t.type}:${t.id}`) },
        });
      }
      return linkedTests(tx, id);
    });
    res.json(result);
  } catch (error) {
    fail(res, error, "change the requirement's tests");
  }
});

router.delete("/api/requirements/:id", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid requirement id" });
  try {
    await withTenantTransaction(async (tx) => {
      const [existing] = await tx.select().from(requirements).where(eq(requirements.id, id)).limit(1);
      if (!existing) throw new RequirementError(404, "Requirement not found");
      await tx.delete(requirements).where(eq(requirements.id, id));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.REQUIREMENT_DELETED,
        actor: auditActor(req),
        targetType: "requirement",
        targetId: id,
        metadata: { key: existing.key, title: existing.title },
      });
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error, "delete the requirement");
  }
});

/**
 * POST /api/requirements/import — { trackerId, keys?, query? }: the issues named, those a JQL or
 * WIQL query finds, or, with neither, the project's epics and stories. Also POST
 * /api/requirements/sync — { trackerId }: brings the ones already imported from it up to date.
 *
 * A story's epic comes along when it is not here yet, so the tree is whole. The tracker is read
 * outside the database transaction: a slow Jira must not hold a connection open.
 */
async function importFrom(req: any, res: Response, keysFromExisting: boolean) {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid import" });
  const organizationId = getTenantOrgId()!;
  try {
    const [tracker] = await withTenantTransaction((tx) => tx.select().from(issueTrackers).where(eq(issueTrackers.id, parsed.data.trackerId)).limit(1));
    if (!tracker) throw new RequirementError(404, "Issue tracker not found.");
    const config = toConfig(tracker);

    let keys = parsed.data.keys;
    if (keysFromExisting) {
      const known = await withTenantTransaction((tx) => tx.select({ key: requirements.key }).from(requirements).where(eq(requirements.trackerId, tracker.id)));
      keys = known.map((k) => k.key);
      if (keys.length === 0) return res.json({ created: [], updated: [], missing: [], found: 0 });
    }

    let items: TrackedItem[];
    try {
      items = await fetchItems(config, { keys, query: parsed.data.query });
      // Up to two levels of parents not in the answer: a story's epic, a feature's epic.
      for (let level = 0; level < 2; level++) {
        const have = new Set(items.map((i) => i.key.toLowerCase()));
        const parents = Array.from(new Set(items.map((i) => i.parentKey).filter((k): k is string => !!k && !have.has(k.toLowerCase()))));
        if (parents.length === 0) break;
        items = items.concat(await fetchItems(config, { keys: parents.slice(0, MAX_IMPORTED_ITEMS) }));
      }
    } catch (error: any) {
      throw new RequirementError(502, `${tracker.name}: ${error?.message ?? error}`);
    }

    const valid = items.filter((i) => REQUIREMENT_KEY_PATTERN.test(i.key));
    const found = new Set(valid.map((i) => i.key.toLowerCase()));
    const missing = (keys ?? []).filter((k) => !found.has(k.toLowerCase()));

    const outcome = await withTenantTransaction(async (tx) => {
      const written = await upsertTrackedItems(tx, organizationId, tracker.id, valid, req.user!.id);
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.REQUIREMENTS_IMPORTED,
        actor: auditActor(req),
        targetType: "issue_tracker",
        targetId: tracker.id,
        metadata: { tracker: tracker.name, created: written.created.length, updated: written.updated.length, sync: keysFromExisting },
      });
      return written;
    });
    res.json({ ...outcome, missing, found: valid.length });
  } catch (error) {
    fail(res, error, "import the requirements");
  }
}

router.post("/api/requirements/import", requireRole("editor"), (req, res) => importFrom(req, res, false));
router.post("/api/requirements/sync", requireRole("editor"), (req, res) => importFrom(req, res, true));

export default router;
