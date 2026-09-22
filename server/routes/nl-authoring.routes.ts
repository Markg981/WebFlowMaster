import { Router } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { projectElements, projects } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { aiService } from "../ai-automation-service";
import { authorSteps } from "../nl-authoring";
import loggerPromise from "../logger";

/**
 * Turning what a test is supposed to do into the steps that do it.
 *
 * A test could only be born from somebody clicking through the application — by hand in the
 * builder, or in front of the recorder. The description already exists, in the ticket or the
 * acceptance criteria, and had to be performed before it could be automated.
 *
 * This route reads sentences and answers with steps. It writes nothing: the author sees what
 * each line became and decides whether to insert it, which is what keeps a wrong reading from
 * quietly becoming a test that passes for the wrong reason.
 */

const router = Router();
const logger = await loggerPromise;

/**
 * Lenient on purpose. These are the elements the builder has detected on the page it is
 * looking at, and they are only ever used as a menu to choose from — a missing tag or a
 * missing id costs a worse label, not a bad step.
 */
const detectedElementSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  selector: z.string().min(1),
  frameSelector: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  tag: z.string().optional(),
  attributes: z.record(z.string()).optional(),
});

const bodySchema = z.object({
  text: z.string().min(1, "Write at least one instruction.").max(8000),
  /** Brings the project's element repository into the catalogue. Optional: the page may be enough. */
  projectId: z.number().int().positive().optional().nullable(),
  elements: z.array(detectedElementSchema).max(500).optional(),
});

// POST /api/authoring/steps — sentences in, proposed steps out. Nothing is saved.
router.post("/api/authoring/steps", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    let repository: RepositoryRow[] = [];
    if (parsed.data.projectId) {
      const loaded = await loadRepository(parsed.data.projectId);
      if (loaded === null) return res.status(404).json({ error: "Project not found." });
      repository = loaded;
    }

    const result = await authorSteps(
      {
        text: parsed.data.text,
        repository,
        detected: parsed.data.elements ?? [],
      },
      // Absent when no key is configured, and `authorSteps` then says so per line instead of
      // failing: the phrasings it understands on its own keep working.
      { propose: aiService.isAvailable() ? (prompt) => aiService.proposeTestSteps(prompt) : undefined },
    );

    res.json({
      steps: result.steps,
      unresolved: result.unresolved,
      usedModel: result.usedModel,
      modelAvailable: aiService.isAvailable(),
      // Names only. What the author needs when a line failed is the list of things they could
      // have named, and a selector is not that.
      catalogue: buildCatalogueListing(repository, parsed.data.elements ?? []),
    });
  } catch (error: any) {
    logger.error({ message: 'Authoring from text failed', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Could not read those instructions." });
  }
});

interface RepositoryRow {
  id: string;
  name: string;
  selector: string;
  frameSelector: string | null;
  tag: string | null;
  elementType: string | null;
  text: string | null;
  attributes: unknown;
}

/** The project's elements, or null when the project is not this organization's. */
async function loadRepository(projectId: number): Promise<RepositoryRow[] | null> {
  return withTenantTransaction(async (tx) => {
    // No organization predicate: RLS supplies it, so another tenant's project is not found
    // here rather than read.
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return null;

    return tx
      .select({
        id: projectElements.id,
        name: projectElements.name,
        selector: projectElements.selector,
        frameSelector: projectElements.frameSelector,
        tag: projectElements.tag,
        elementType: projectElements.elementType,
        text: projectElements.text,
        attributes: projectElements.attributes,
      })
      .from(projectElements)
      .where(eq(projectElements.projectId, projectId))
      .orderBy(asc(projectElements.name));
  });
}

function buildCatalogueListing(
  repository: { name: string }[],
  detected: z.infer<typeof detectedElementSchema>[],
) {
  return {
    repository: repository.map((element) => element.name),
    detected: detected.length,
  };
}

export default router;
