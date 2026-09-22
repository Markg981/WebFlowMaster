import { Router } from "express";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import { apiTests, tags, testTags, tests } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { normaliseTagName, setTagsForTest } from "../test-tags";
import loggerPromise from "../logger";

/**
 * The words an organization files its tests under.
 *
 * A test belonged to a project and to nothing else, so every grouping a team actually works
 * with — the smoke set, everything that touches checkout, the slow ones — lived in people's
 * heads and in the names they typed. A plan was assembled by hand, one test at a time, and
 * stayed that way: the test written next week is in no plan until somebody remembers it.
 */

const router = Router();
const logger = await loggerPromise;

const nameSchema = z.object({ name: z.string().trim().min(1, "A tag needs a name").max(60) });
const assignmentSchema = z.object({ tagIds: z.array(z.string()).max(50) });

function isUniqueViolation(error: any): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('unique') || error?.code === '23505';
}

// GET /api/tags — every tag, with how much it is actually used.
router.get("/api/tags", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    // The counts are what makes a list of tags maintainable: a tag on nothing is either a typo
    // or a leftover, and without the number there is no way to tell it from one in daily use.
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({
          id: tags.id,
          name: tags.name,
          createdAt: tags.createdAt,
          uiCount: sql<number>`count(distinct ${testTags.testId})`,
          apiCount: sql<number>`count(distinct ${testTags.apiTestId})`,
        })
        .from(tags)
        .leftJoin(testTags, eq(testTags.tagId, tags.id))
        .groupBy(tags.id, tags.name, tags.createdAt)
        .orderBy(asc(tags.name)),
    );

    res.json(rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      uiCount: Number(row.uiCount ?? 0),
      apiCount: Number(row.apiCount ?? 0),
    })));
  } catch (error: any) {
    logger.error({ message: 'Failed to list tags', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to load tags." });
  }
});

/**
 * POST /api/tags — a tag by name.
 *
 * A name that already exists answers 200 with the tag that has it, rather than 409. The caller
 * is a picker where somebody typed a word: two people tagging tests at the same time both mean
 * the same "smoke", and making the second one handle a conflict in order to arrive at the tag
 * they asked for serves nothing. Creating answers 201, so a caller that cares can still tell.
 */
router.post("/api/tags", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }
  const name = normaliseTagName(parsed.data.name);

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [existing] = await tx
        .select({ id: tags.id, name: tags.name, createdAt: tags.createdAt })
        .from(tags)
        .where(sql`lower(${tags.name}) = lower(${name})`)
        .limit(1);
      if (existing) return { created: false, tag: existing };

      const [row] = await tx
        .insert(tags)
        .values({ id: uuidv4(), organizationId: req.user!.organizationId, name })
        .returning();
      return { created: true, tag: { id: row.id, name: row.name, createdAt: row.createdAt } };
    });

    res.status(outcome.created ? 201 : 200).json(outcome.tag);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      // Two requests for the same new tag at the same instant. The loser reads it back.
      const [existing] = await withTenantTransaction((tx) =>
        tx.select({ id: tags.id, name: tags.name, createdAt: tags.createdAt })
          .from(tags)
          .where(sql`lower(${tags.name}) = lower(${name})`)
          .limit(1),
      );
      if (existing) return res.status(200).json(existing);
    }
    logger.error({ message: 'Failed to create tag', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to create the tag." });
  }
});

// PUT /api/tags/:id — a rename, which every test carrying it follows.
router.put("/api/tags/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }
  const name = normaliseTagName(parsed.data.name);

  try {
    const updated = await withTenantTransaction((tx) =>
      tx.update(tags).set({ name }).where(eq(tags.id, req.params.id)).returning(),
    );
    if (updated.length === 0) return res.status(404).json({ error: "Tag not found." });
    res.json({ id: updated[0].id, name: updated[0].name, createdAt: updated[0].createdAt });
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: `This organization already has a tag called "${name}".` });
    }
    logger.error({ message: 'Failed to rename tag', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to rename the tag." });
  }
});

/**
 * DELETE /api/tags/:id — and it goes off every test carrying it.
 *
 * Not refused while in use, unlike deleting a step group or a repository element. Those are
 * depended on: a test that loses one runs differently. A tag describes tests without changing
 * what any of them does, so the only cost of removing one is that a grouping stops existing —
 * which is exactly what somebody deleting it is asking for. The count of assignments removed
 * comes back so the answer is not silent about how much it did.
 */
router.delete("/api/tags/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(testTags)
        .where(eq(testTags.tagId, req.params.id));

      const deleted = await tx.delete(tags).where(eq(tags.id, req.params.id)).returning();
      return { deleted: deleted.length, removedFrom: Number(count ?? 0) };
    });

    if (outcome.deleted === 0) return res.status(404).json({ error: "Tag not found." });
    res.json({ removedFrom: outcome.removedFrom });
  } catch (error: any) {
    logger.error({ message: 'Failed to delete tag', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to delete the tag." });
  }
});

// PUT /api/tests/:id/tags — the whole set a UI test carries.
router.put("/api/tests/:id/tags", requireRole('editor'), async (req, res) => {
  await assignTags(req, res, 'ui');
});

// PUT /api/api-tests/:id/tags — the same, for an API test.
router.put("/api/api-tests/:id/tags", requireRole('editor'), async (req, res) => {
  await assignTags(req, res, 'api');
});

async function assignTags(req: any, res: any, testType: 'ui' | 'api') {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid test id" });

  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      // The test has to be one of ours, and RLS is what decides that: another tenant's id is
      // not found here rather than tagged.
      const table = testType === 'ui' ? tests : apiTests;
      const [existing] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
      if (!existing) return { missing: true as const };

      return {
        missing: false as const,
        result: await setTagsForTest(tx, {
          organizationId: req.user.organizationId,
          testType,
          testId: id,
          tagIds: parsed.data.tagIds,
        }),
      };
    });

    if (outcome.missing) return res.status(404).json({ error: "Test not found" });
    if (!outcome.result.ok) {
      return res.status(400).json({
        error: "Some of those tags do not exist.",
        unknownTagIds: outcome.result.unknownTagIds,
      });
    }
    res.json({ tags: outcome.result.tags });
  } catch (error: any) {
    logger.error({ message: 'Failed to set tags', error: error?.message ?? String(error), testType, id });
    res.status(500).json({ error: "Failed to set the tags." });
  }
}

export default router;
