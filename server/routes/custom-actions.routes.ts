import { Router } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { AUDIT_ACTIONS, customActions, stepGroups, tests } from "@shared/schema";
import { PARAMETER_NAME_PATTERN, customActionIdOf } from "@shared/custom-actions";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { auditActor, recordAudit } from "../audit";
import { asSteps } from "../step-groups";
import loggerPromise from "../logger";

/**
 * The organization's own steps (shared/custom-actions.ts).
 *
 * Editors write them, as they write `Run JavaScript` steps: an action has no power that step
 * does not already have. Every change is audited all the same, because an edit here changes
 * what every test that uses the action does on its next run.
 */

const router = Router();
const logger = await loggerPromise;

/** Long enough for a real helper, short enough that nobody pastes a library into a step. */
const MAX_SCRIPT_LENGTH = 20_000;

const parameterSchema = z.object({
  name: z.string().trim().regex(PARAMETER_NAME_PATTERN, "A parameter name is letters, digits and _, not starting with a digit"),
  description: z.string().trim().max(200).optional().nullable(),
  required: z.boolean().default(true),
});

const bodySchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  parameters: z
    .array(parameterSchema)
    .max(20)
    .default([])
    .refine((list) => new Set(list.map((p) => p.name)).size === list.length, "Two parameters have the same name"),
  script: z.string().min(1, "The script is empty").max(MAX_SCRIPT_LENGTH),
});

const isDuplicateName = (error: any) => /custom_actions_organization_name_idx|duplicate key/i.test(error?.message ?? "");

/** Which tests and step groups call an action, by name. */
async function usersOf(tx: any, id: string): Promise<string[]> {
  const calls = (sequence: unknown) => asSteps(sequence).some((step) => customActionIdOf(step.action?.id) === id);
  const testRows: { name: string; sequence: unknown }[] = await tx.select({ name: tests.name, sequence: tests.sequence }).from(tests);
  const groupRows: { name: string; sequence: unknown }[] = await tx.select({ name: stepGroups.name, sequence: stepGroups.sequence }).from(stepGroups);
  return [
    ...testRows.filter((row) => calls(row.sequence)).map((row) => row.name),
    ...groupRows.filter((row) => calls(row.sequence)).map((row) => `${row.name} (step group)`),
  ];
}

// GET /api/custom-actions — what the builder offers, by name.
router.get("/api/custom-actions", requireRole("viewer"), async (_req, res) => {
  const rows = await withTenantTransaction((tx) => tx.select().from(customActions).orderBy(asc(customActions.name)));
  res.json(rows);
});

router.post("/api/custom-actions", requireRole("editor"), async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  try {
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(customActions)
        .values({
          id: uuidv4(),
          // From the session, never the body.
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          parameters: parsed.data.parameters,
          script: parsed.data.script,
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.CUSTOM_ACTION_CREATED,
        actor: auditActor(req),
        targetType: "custom_action",
        targetId: row.id,
        metadata: { name: row.name, parameters: parsed.data.parameters.map((p) => p.name), scriptLength: row.script.length },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error: any) {
    if (isDuplicateName(error)) return res.status(409).json({ error: "A custom action with this name already exists." });
    logger.error({ message: "Failed to create custom action", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to create the custom action." });
  }
});

router.put("/api/custom-actions/:id", requireRole("editor"), async (req, res) => {
  const parsed = bodySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No update data provided." });
  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .update(customActions)
        .set({
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.parameters !== undefined ? { parameters: parsed.data.parameters } : {}),
          ...(parsed.data.script !== undefined ? { script: parsed.data.script } : {}),
          updatedAt: new Date(),
        })
        .where(eq(customActions.id, req.params.id))
        .returning();
      if (!row) return null;
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.CUSTOM_ACTION_UPDATED,
        actor: auditActor(req),
        targetType: "custom_action",
        targetId: row.id,
        // Which fields changed, not the script: the log is read by every owner, and a script
        // is the organization's code.
        metadata: { name: row.name, changed: Object.keys(parsed.data), scriptLength: row.script.length },
      });
      return row;
    });
    if (!updated) return res.status(404).json({ error: "Custom action not found." });
    res.json(updated);
  } catch (error: any) {
    if (isDuplicateName(error)) return res.status(409).json({ error: "A custom action with this name already exists." });
    logger.error({ message: "Failed to update custom action", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to update the custom action." });
  }
});

/** Refused while something still uses it, naming what: the same rule as a step group. */
router.delete("/api/custom-actions/:id", requireRole("editor"), async (req, res) => {
  const { id } = req.params;
  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const using = await usersOf(tx, id);
      if (using.length > 0) return { blockedBy: using };
      const [row] = await tx.delete(customActions).where(eq(customActions.id, id)).returning();
      if (!row) return { deleted: null };
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.CUSTOM_ACTION_DELETED,
        actor: auditActor(req),
        targetType: "custom_action",
        targetId: row.id,
        metadata: { name: row.name },
      });
      return { deleted: row };
    });
    if ("blockedBy" in outcome && outcome.blockedBy) {
      return res.status(409).json({ error: `This custom action is still used by ${outcome.blockedBy.length} test(s) or group(s).`, tests: outcome.blockedBy });
    }
    if (!("deleted" in outcome) || !outcome.deleted) return res.status(404).json({ error: "Custom action not found." });
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ message: "Failed to delete custom action", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to delete the custom action." });
  }
});

// GET /api/custom-actions/:id/usage — what an edit is about to change.
router.get("/api/custom-actions/:id/usage", requireRole("viewer"), async (req, res) => {
  const using = await withTenantTransaction((tx) => usersOf(tx, req.params.id));
  res.json(using);
});

export default router;
