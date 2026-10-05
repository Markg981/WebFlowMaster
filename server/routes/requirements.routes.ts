import { quotaErrorBody } from '../tenant-quotas';
import { Router, type Response } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { TEST_KINDS, firstMissingKind, itemOf, linkColumns, linkWhere, missingMessage, namedItems } from "../test-refs";
import { AUDIT_ACTIONS, apiTests, issueTrackers, requirementTests, requirements, tests } from "@shared/schema";
import { REQUIREMENT_KEY_PATTERN, REQUIREMENT_KINDS } from "@shared/requirements";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId, type TenantTx } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { fetchItemText, fetchItems, MAX_IMPORTED_ITEMS, type TrackedItem } from "../issue-providers";
import { toConfig } from "../issue-store";
import { describeScope, loadCoverage, matrixCsv, upsertTrackedItems, wouldLoop, type CoverageScope } from "../requirements";
import loggerPromise from "../logger";
import { aiService } from "../ai-automation-service";
import { htmlToText } from "../email-inbox";
import { toSequence } from "@shared/manual-tests";
import { recordTestVersion } from "../test-version-store";
import { MAX_PROPOSALS, MAX_STEPS, PROPOSAL_LANGUAGES, buildStoryPrompt, parseProposals, type ProposalLanguage } from "../story-tests";

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
  const quota = quotaErrorBody(error);
  if (quota) return res.status(429).json(quota);
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
  items: z.array(z.object({ type: z.enum(TEST_KINDS), id: z.number().int().positive() })).max(1000),
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
  return namedItems(tx, links.map(itemOf));
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

      const missing = await firstMissingKind(tx, parsed.data.items);
      if (missing) throw new RequirementError(400, missingMessage(missing));

      const current = await linkedTests(tx, id);
      const have = new Set(current.map((t) => `${t.type}:${t.id}`));
      const removed = current.filter((t) => t.name !== null && !wanted.has(`${t.type}:${t.id}`));
      for (const test of removed) {
        await tx
          .delete(requirementTests)
          .where(
            and(
              eq(requirementTests.requirementId, id),
              linkWhere(requirementTests, test),
            ),
          );
      }
      const added = parsed.data.items.filter((i, index, all) => !have.has(`${i.type}:${i.id}`) && all.findIndex((o) => o.type === i.type && o.id === i.id) === index);
      if (added.length) {
        await tx.insert(requirementTests).values(
          added.map((item) => ({
            organizationId: getTenantOrgId()!,
            requirementId: id,
            ...linkColumns(item),
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

const proposalSchema = z.object({
  language: z.enum(Object.keys(PROPOSAL_LANGUAGES) as [ProposalLanguage, ...ProposalLanguage[]]).default("en"),
  count: z.number().int().min(1).max(MAX_PROPOSALS).default(6),
});

/**
 * POST /api/requirements/:id/test-proposals — { language?, count? }: test cases the model proposes
 * for the story, from its text in the tracker (read now, so an edited story gives new
 * proposals) or, for one typed in here, its description. Nothing is saved.
 */
router.post("/api/requirements/:id/test-proposals", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = proposalSchema.safeParse(req.body ?? {});
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Invalid payload" });
  if (!aiService.isAvailable()) {
    return res.status(503).json({ error: "No AI model is configured on this server (GEMINI_API_KEY)." });
  }
  try {
    const loaded = await withTenantTransaction(async (tx) => {
      const [requirement] = await tx.select().from(requirements).where(eq(requirements.id, id)).limit(1);
      if (!requirement) throw new RequirementError(404, "Requirement not found");
      const [tracker] = requirement.trackerId ? await tx.select().from(issueTrackers).where(eq(issueTrackers.id, requirement.trackerId)).limit(1) : [];
      return { requirement, tracker: tracker ?? null };
    });
    const { requirement, tracker } = loaded;

    // The tracker is read outside the transaction, like an import: a slow Jira must not hold a
    // connection open.
    let story = { key: requirement.key, title: requirement.title, description: requirement.description ?? "", acceptance: "" };
    let source: "tracker" | "requirement" = "requirement";
    if (tracker) {
      try {
        const text = await fetchItemText(toConfig(tracker), requirement.key, htmlToText);
        if (text) {
          story = { key: requirement.key, ...text };
          source = "tracker";
        }
      } catch (error: any) {
        throw new RequirementError(502, `${tracker.name}: ${error?.message ?? error}`);
      }
    }
    if (!story.description.trim() && !story.acceptance.trim()) {
      throw new RequirementError(
        422,
        source === "tracker"
          ? `${requirement.key} has no description or acceptance criteria in ${tracker!.name} to write tests from.`
          : `${requirement.key} has no description to write tests from. Add one, with its acceptance criteria.`,
      );
    }

    const answer = await aiService.proposeTestCases(buildStoryPrompt(story, parsed.data.language, parsed.data.count));
    const proposals = parseProposals(answer);
    if (!proposals) throw new RequirementError(502, "The model gave no usable test cases. Try again, or add detail to the story.");
    res.json({ proposals, source, story: { key: story.key, title: story.title, description: story.description, acceptance: story.acceptance } });
  } catch (error) {
    fail(res, error, "propose tests");
  }
});

const generatedSchema = z.object({
  tests: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Every test needs a name.").max(200),
        steps: z
          .array(z.object({ action: z.string().trim().min(1).max(1000), expected: z.string().trim().max(1000) }))
          .min(1, "Every test needs at least one step.")
          .max(MAX_STEPS + 1),
      }),
    )
    .min(1)
    .max(MAX_PROPOSALS),
});

/**
 * POST /api/requirements/:id/generated-tests — { tests: [{ name, steps: [{ action, expected }] }] }:
 * creates the chosen proposals as manual tests, as edited, linked to the requirement. All or
 * none: a name that is taken refuses the lot, naming it, so nothing is half created.
 */
router.post("/api/requirements/:id/generated-tests", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = generatedSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    return res.status(400).json({ error: parsed.success ? "Invalid requirement id" : parsed.error.issues[0]?.message ?? "Invalid payload" });
  }
  const names = parsed.data.tests.map((t) => t.name);
  const repeated = names.filter((name, index) => names.findIndex((n) => n.toLowerCase() === name.toLowerCase()) !== index);
  if (repeated.length) return res.status(400).json({ error: `Two tests have the same name: ${repeated.join(", ")}.`, names: repeated });
  try {
    const created = await withTenantTransaction(async (tx) => {
      const [requirement] = await tx.select().from(requirements).where(eq(requirements.id, id)).limit(1);
      if (!requirement) throw new RequirementError(404, "Requirement not found");
      const taken = await tx.select({ name: tests.name }).from(tests).where(inArray(tests.name, names));
      if (taken.length) {
        const list = taken.map((t) => t.name);
        throw Object.assign(new RequirementError(409, `A test with this name already exists: ${list.join(", ")}.`), { names: list });
      }

      const organizationId = getTenantOrgId()!;
      const rows = [];
      for (const test of parsed.data.tests) {
        const [row] = await tx
          .insert(tests)
          // A manual test, as the library's own dialog makes one: no address, no elements.
          .values({ name: test.name, url: "", sequence: toSequence(test.steps), elements: [], userId: req.user!.id, organizationId })
          .returning();
        await recordTestVersion(tx, { testId: row.id, organizationId, userId: req.user!.id, test: row });
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TEST_CREATED,
          actor: auditActor(req),
          targetType: "test",
          targetId: row.id,
          metadata: { name: row.name, generatedFrom: requirement.key },
        });
        rows.push(row);
      }
      await tx.insert(requirementTests).values(
        rows.map((row) => ({ organizationId, requirementId: id, testType: "ui" as const, testId: row.id, apiTestId: null, createdBy: req.user!.id })),
      );
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.REQUIREMENT_TESTS_CHANGED,
        actor: auditActor(req),
        targetType: "requirement",
        targetId: id,
        metadata: { key: requirement.key, added: rows.map((row) => `ui:${row.id}`), removed: [], generated: true },
      });
      return rows.map((row) => ({ id: row.id, name: row.name }));
    });
    res.status(201).json({ created });
  } catch (error: any) {
    if (error instanceof RequirementError && error.status === 409) return res.status(409).json({ error: error.message, names: (error as any).names });
    fail(res, error, "create the tests");
  }
});

router.post("/api/requirements/import", requireRole("editor"), (req, res) => importFrom(req, res, false));
router.post("/api/requirements/sync", requireRole("editor"), (req, res) => importFrom(req, res, true));

export default router;
