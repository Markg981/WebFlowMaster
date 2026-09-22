import { Router } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import { projectElements, projects, tests } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { referencedElementIds } from "../step-elements";
import loggerPromise from "../logger";

/**
 * The elements of an application, kept once instead of once per test.
 *
 * Deleting one is refused while tests still name it, for the same reason deleting a step group
 * is: those tests do not stop working, they fall back to whatever selector they were saved
 * with — silently running on a stale copy of the thing the repository was supposed to own.
 */

const router = Router();
const logger = await loggerPromise;

const elementBodySchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(120),
  selector: z.string().trim().min(1, "A selector is required").max(2000),
  frameSelector: z.string().trim().max(2000).optional().nullable(),
  tag: z.string().trim().max(50).optional().nullable(),
  elementType: z.string().trim().max(50).optional().nullable(),
  text: z.string().max(500).optional().nullable(),
  attributes: z.record(z.string()).optional().nullable(),
});

const updateElementBodySchema = elementBodySchema.partial();

function isUniqueViolation(error: any): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('unique') || error?.code === '23505';
}

// GET /api/projects/:projectId/elements
router.get("/api/projects/:projectId/elements", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Invalid project id." });

  // No organization predicate: RLS supplies it, so another tenant's project has no elements
  // here rather than someone else's.
  const elements = await withTenantTransaction((tx) =>
    tx.select().from(projectElements).where(eq(projectElements.projectId, projectId)).orderBy(asc(projectElements.name)),
  );
  res.json(elements);
});

// POST /api/projects/:projectId/elements — usually a detected element being kept.
router.post("/api/projects/:projectId/elements", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Invalid project id." });

  const parsed = elementBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    const created = await withTenantTransaction(async (tx) => {
      // The project has to be one of ours, and RLS is what decides that: naming another
      // tenant's project id finds nothing rather than writing into it.
      const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project) return null;

      const [row] = await tx
        .insert(projectElements)
        .values({
          id: uuidv4(),
          organizationId: req.user!.organizationId,
          projectId,
          name: parsed.data.name,
          selector: parsed.data.selector,
          // Kept as it first was, so healing moving `selector` later still leaves an answer to
          // "what did this used to be?".
          originalSelector: parsed.data.selector,
          frameSelector: parsed.data.frameSelector ?? null,
          tag: parsed.data.tag ?? null,
          elementType: parsed.data.elementType ?? null,
          text: parsed.data.text ?? null,
          attributes: parsed.data.attributes ?? null,
        })
        .returning();
      return row;
    });

    if (!created) return res.status(404).json({ error: "Project not found." });
    res.status(201).json(created);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: `This project already has an element called "${parsed.data.name}".` });
    }
    logger.error({ message: 'Failed to create project element', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to save the element." });
  }
});

// PUT /api/project-elements/:id — a rename, or a selector corrected by hand.
router.put("/api/project-elements/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = updateElementBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No update data provided." });
  }

  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .update(projectElements)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(projectElements.id, req.params.id))
        .returning();
      return row;
    });
    if (!updated) return res.status(404).json({ error: "Element not found." });
    res.json(updated);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: "This project already has an element with that name." });
    }
    logger.error({ message: 'Failed to update project element', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to update the element." });
  }
});

// GET /api/project-elements/:id/usage — which tests name this element.
router.get("/api/project-elements/:id/usage", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const callers = await withTenantTransaction((tx) =>
    tx.select({ id: tests.id, name: tests.name, sequence: tests.sequence }).from(tests),
  );
  res.json(
    callers
      .filter((test) => referencedElementIds(test.sequence).includes(req.params.id))
      .map((test) => ({ id: test.id, name: test.name })),
  );
});

// DELETE /api/project-elements/:id
router.delete("/api/project-elements/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const callers = await tx.select({ name: tests.name, sequence: tests.sequence }).from(tests);
      const using = callers.filter((test) => referencedElementIds(test.sequence).includes(id)).map((t) => t.name);
      if (using.length > 0) return { blockedBy: using };

      const [row] = await tx.delete(projectElements).where(eq(projectElements.id, id)).returning();
      return { deleted: row };
    });

    if ('blockedBy' in outcome && outcome.blockedBy) {
      return res.status(409).json({
        error: `This element is still used by ${outcome.blockedBy.length} test(s).`,
        tests: outcome.blockedBy,
      });
    }
    if (!('deleted' in outcome) || !outcome.deleted) return res.status(404).json({ error: "Element not found." });
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ message: 'Failed to delete project element', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to delete the element." });
  }
});

export default router;
