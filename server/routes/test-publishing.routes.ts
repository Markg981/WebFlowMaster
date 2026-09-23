import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { testReviews, testVersions, tests, users } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { auditActor } from "../audit";
import {
  PublishingError,
  approveReview,
  publish,
  publishingStateOf,
  rejectReview,
  requestReview,
  reviewRequired,
  rollback,
  setReviewRequired,
  unpublish,
  withdrawReview,
} from "../test-publishing";
import loggerPromise from "../logger";

/**
 * Publishing tests, reviewing them, and rolling back. See server/test-publishing.ts for the rules;
 * these handlers only parse, call and translate.
 */

const router = Router();
const logger = await loggerPromise;

function idParam(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof PublishingError) return res.status(error.status).json({ error: error.message, code: error.code });
  logger.error({ message: `Failed to ${what}`, error: (error as Error)?.message ?? String(error) });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

// GET /api/tests/:id/publishing — what runs, what is waiting, what can be rolled back to.
router.get("/api/tests/:id/publishing", requireRole("viewer"), async (req, res) => {
  const testId = idParam(req.params.id);
  if (!testId) return res.status(400).json({ error: "Invalid test id" });
  try {
    res.json(await withTenantTransaction((tx) => publishingStateOf(tx, testId, getTenantOrgId()!)));
  } catch (error) {
    fail(res, error, "load the publishing state");
  }
});

// POST /api/tests/:id/publish — publish a version (the latest by default), where no review is required.
router.post("/api/tests/:id/publish", requireRole("editor"), async (req, res) => {
  const testId = idParam(req.params.id);
  const parsed = z.object({ version: z.number().int().positive().optional() }).safeParse(req.body ?? {});
  if (!testId || !parsed.success) return res.status(400).json({ error: "Invalid request" });
  try {
    await withTenantTransaction((tx) => publish(tx, testId, getTenantOrgId()!, auditActor(req), parsed.data.version));
    res.json(await withTenantTransaction((tx) => publishingStateOf(tx, testId, getTenantOrgId()!)));
  } catch (error) {
    fail(res, error, "publish the test");
  }
});

// POST /api/tests/:id/rollback — put back a version that was live before.
router.post("/api/tests/:id/rollback", requireRole("editor"), async (req, res) => {
  const testId = idParam(req.params.id);
  const parsed = z.object({ version: z.number().int().positive() }).safeParse(req.body ?? {});
  if (!testId || !parsed.success) return res.status(400).json({ error: "Name the version to roll back to." });
  try {
    await withTenantTransaction((tx) => rollback(tx, testId, getTenantOrgId()!, auditActor(req), parsed.data.version));
    res.json(await withTenantTransaction((tx) => publishingStateOf(tx, testId, getTenantOrgId()!)));
  } catch (error) {
    fail(res, error, "roll the test back");
  }
});

// POST /api/tests/:id/unpublish — plans run the working copy again.
router.post("/api/tests/:id/unpublish", requireRole("editor"), async (req, res) => {
  const testId = idParam(req.params.id);
  if (!testId) return res.status(400).json({ error: "Invalid test id" });
  try {
    await withTenantTransaction((tx) => unpublish(tx, testId, getTenantOrgId()!, auditActor(req)));
    res.json(await withTenantTransaction((tx) => publishingStateOf(tx, testId, getTenantOrgId()!)));
  } catch (error) {
    fail(res, error, "unpublish the test");
  }
});

// POST /api/tests/:id/reviews — ask for the latest version to be reviewed.
router.post("/api/tests/:id/reviews", requireRole("editor"), async (req, res) => {
  const testId = idParam(req.params.id);
  const parsed = z.object({ note: z.string().max(2000).optional() }).safeParse(req.body ?? {});
  if (!testId || !parsed.success) return res.status(400).json({ error: "Invalid request" });
  try {
    const review = await withTenantTransaction((tx) => requestReview(tx, testId, getTenantOrgId()!, auditActor(req), parsed.data.note));
    res.status(201).json(review);
  } catch (error) {
    fail(res, error, "request a review");
  }
});

/**
 * GET /api/test-reviews — the review queue, pending by default. What a reviewer needs to decide
 * without opening each test: which test, which version, what changed, who asked.
 */
router.get("/api/test-reviews", requireRole("viewer"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  if (!["pending", "approved", "rejected", "withdrawn"].includes(status)) {
    return res.status(400).json({ error: "Unknown status" });
  }
  try {
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({
          id: testReviews.id,
          testId: testReviews.testId,
          testName: tests.name,
          version: testReviews.version,
          publishedVersion: tests.publishedVersion,
          summary: testVersions.summary,
          versionAuthorId: testVersions.createdBy,
          note: testReviews.note,
          status: testReviews.status,
          requestedBy: testReviews.requestedBy,
          requestedByName: users.username,
          requestedAt: testReviews.requestedAt,
          decisionComment: testReviews.decisionComment,
          decidedAt: testReviews.decidedAt,
        })
        .from(testReviews)
        // RLS on tests hides a restricted project's reviews along with the project.
        .innerJoin(tests, eq(tests.id, testReviews.testId))
        .leftJoin(testVersions, and(eq(testVersions.testId, testReviews.testId), eq(testVersions.version, testReviews.version)))
        .leftJoin(users, eq(users.id, testReviews.requestedBy))
        .where(eq(testReviews.status, status as "pending"))
        .orderBy(desc(testReviews.requestedAt))
        .limit(200),
    );
    // Whether the caller may decide each one: not their own request, not their own change.
    res.json(rows.map((row) => ({ ...row, canDecide: row.requestedBy !== req.user!.id && row.versionAuthorId !== req.user!.id })));
  } catch (error) {
    fail(res, error, "load the reviews");
  }
});

const decisionSchema = z.object({ comment: z.string().max(2000).optional() });

router.post("/api/test-reviews/:id/approve", requireRole("editor"), async (req, res) => {
  const reviewId = idParam(req.params.id);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!reviewId || !parsed.success) return res.status(400).json({ error: "Invalid request" });
  try {
    res.json(await withTenantTransaction((tx) => approveReview(tx, reviewId, getTenantOrgId()!, auditActor(req), parsed.data.comment)));
  } catch (error) {
    fail(res, error, "approve the review");
  }
});

// A rejection says why: "rejected" alone sends the author back with nothing to fix.
router.post("/api/test-reviews/:id/reject", requireRole("editor"), async (req, res) => {
  const reviewId = idParam(req.params.id);
  const parsed = z.object({ comment: z.string().trim().min(1).max(2000) }).safeParse(req.body ?? {});
  if (!reviewId || !parsed.success) return res.status(400).json({ error: "Say what needs to change." });
  try {
    res.json(await withTenantTransaction((tx) => rejectReview(tx, reviewId, auditActor(req), parsed.data.comment)));
  } catch (error) {
    fail(res, error, "reject the review");
  }
});

router.post("/api/test-reviews/:id/withdraw", requireRole("editor"), async (req, res) => {
  const reviewId = idParam(req.params.id);
  if (!reviewId) return res.status(400).json({ error: "Invalid review id" });
  try {
    res.json(await withTenantTransaction((tx) => withdrawReview(tx, reviewId, auditActor(req))));
  } catch (error) {
    fail(res, error, "withdraw the review");
  }
});

// GET /api/organization/test-review-policy — whether publishing needs a review. Everyone may know.
router.get("/api/organization/test-review-policy", requireRole("viewer"), async (_req, res) => {
  const required = await withTenantTransaction((tx) => reviewRequired(tx, getTenantOrgId()!));
  res.json({ required });
});

// PUT /api/organization/test-review-policy — owners only.
router.put("/api/organization/test-review-policy", requireRole("owner"), async (req, res) => {
  const parsed = z.object({ required: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  await setReviewRequired(getTenantOrgId()!, auditActor(req), parsed.data.required);
  res.json({ required: parsed.data.required });
});

export default router;
