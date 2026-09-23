import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import { stepGroups, tests, AdhocTestStepSchema } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { asSteps, isGroupCall, referencedGroupIds } from "../step-groups";
import loggerPromise from "../logger";

/**
 * The named sequences tests call instead of repeating them.
 *
 * A group is an ordinary sequence with a name, so it is validated as one. The single rule it
 * has beyond that: it may not call another group. One level keeps expansion finite without a
 * cycle check, and refusing it here — at the moment somebody tries to write it — is a better
 * error than discovering it at two in the morning when a run expands forever.
 */

const router = Router();
const logger = await loggerPromise;

/**
 * A project the group cannot go into: one that does not exist (the foreign key), or one the
 * requester cannot edit or see (row-level security, migration 0031). One answer for both, so it
 * does not say whether a restricted project exists.
 */
const isUnreachableProject = (error: any) => /foreign key|row-level security/i.test(error?.message ?? "");

const stepGroupBodySchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  projectId: z.number().int().positive().optional().nullable(),
  sequence: z.array(AdhocTestStepSchema).min(1, "A step group needs at least one step"),
});

const updateStepGroupBodySchema = stepGroupBodySchema.partial();

/** The rule that keeps expansion one level deep, enforced where it is written. */
function callsAnotherGroup(sequence: unknown): boolean {
  return asSteps(sequence).some(isGroupCall);
}

// GET /api/step-groups — everything this organization can call, newest first.
router.get("/api/step-groups", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  // No organization predicate: RLS supplies it.
  const groups = await withTenantTransaction((tx) =>
    tx.select().from(stepGroups).orderBy(desc(stepGroups.updatedAt)),
  );
  res.json(groups.map((group) => ({ ...group, sequence: asSteps(group.sequence) })));
});

// POST /api/step-groups
router.post("/api/step-groups", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = stepGroupBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }
  if (callsAnotherGroup(parsed.data.sequence)) {
    return res.status(400).json({ error: "A step group cannot call another step group." });
  }

  const id = uuidv4();
  try {
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(stepGroups)
        .values({
          id,
          // From the session, never the body: the tenancy boundary is not a client's to name.
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          projectId: parsed.data.projectId ?? null,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          sequence: parsed.data.sequence,
        })
        .returning();
      return row;
    });
    res.status(201).json({ ...created, sequence: asSteps(created.sequence) });
  } catch (error: any) {
    if (isUnreachableProject(error)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
    logger.error({ message: 'Failed to create step group', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to create the step group." });
  }
});

// PUT /api/step-groups/:id — the edit that changes what every calling test does next run.
router.put("/api/step-groups/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = updateStepGroupBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }
  if (parsed.data.sequence && callsAnotherGroup(parsed.data.sequence)) {
    return res.status(400).json({ error: "A step group cannot call another step group." });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No update data provided." });
  }

  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .update(stepGroups)
        .set({
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.projectId !== undefined ? { projectId: parsed.data.projectId ?? null } : {}),
          ...(parsed.data.sequence !== undefined ? { sequence: parsed.data.sequence } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stepGroups.id, req.params.id))
        .returning();
      return row;
    });
    if (!updated) return res.status(404).json({ error: "Step group not found." });
    res.json({ ...updated, sequence: asSteps(updated.sequence) });
  } catch (error: any) {
    if (isUnreachableProject(error)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
    logger.error({ message: 'Failed to update step group', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to update the step group." });
  }
});

/**
 * DELETE /api/step-groups/:id
 *
 * Refused while tests still call it. A deleted group does not shorten those tests, it fails
 * them — which is the right behaviour at run time and a terrible way to find out at edit time.
 * The tests that would break are named, because "in use" without saying by what is a dead end.
 */
router.delete("/api/step-groups/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const callers = await tx.select({ id: tests.id, name: tests.name, sequence: tests.sequence }).from(tests);
      const using = callers
        .filter((test) => referencedGroupIds(test.sequence).includes(id))
        .map((test) => test.name);
      if (using.length > 0) return { blockedBy: using };

      const [row] = await tx.delete(stepGroups).where(eq(stepGroups.id, id)).returning();
      return { deleted: row };
    });

    if ('blockedBy' in outcome && outcome.blockedBy) {
      return res.status(409).json({
        error: `This step group is still called by ${outcome.blockedBy.length} test(s).`,
        tests: outcome.blockedBy,
      });
    }
    if (!('deleted' in outcome) || !outcome.deleted) return res.status(404).json({ error: "Step group not found." });
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ message: 'Failed to delete step group', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to delete the step group." });
  }
});

/**
 * GET /api/step-groups/:id/usage — which tests call this group.
 *
 * The question anyone asks before editing one: changing a group changes every test that calls
 * it, and there was no way to know which those were.
 */
router.get("/api/step-groups/:id/usage", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const callers = await withTenantTransaction((tx) =>
    tx.select({ id: tests.id, name: tests.name, sequence: tests.sequence }).from(tests),
  );
  res.json(
    callers
      .filter((test) => referencedGroupIds(test.sequence).includes(id))
      .map((test) => ({ id: test.id, name: test.name })),
  );
});

export default router;
