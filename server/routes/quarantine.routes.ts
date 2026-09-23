import { Router, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { auditActor } from "../audit";
import { QuarantineError, listOpenQuarantines, quarantineTest, releaseQuarantine } from "../test-quarantine";
import loggerPromise from "../logger";

/**
 * Setting unreliable tests aside, and bringing them back. What quarantine means for a run is in
 * server/test-quarantine.ts.
 */

const router = Router();
const logger = await loggerPromise;

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof QuarantineError) return res.status(error.status).json({ error: error.message, code: error.code });
  logger.error({ message: `Failed to ${what}`, error: (error as Error)?.message });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

// GET /api/quarantine — the tests in quarantine, and how each has done since.
router.get("/api/quarantine", requireRole("viewer"), async (_req, res) => {
  try {
    res.json(await withTenantTransaction((tx) => listOpenQuarantines(tx)));
  } catch (error) {
    fail(res, error, "load the quarantined tests");
  }
});

const quarantineSchema = z.object({
  testType: z.enum(["ui", "api"]),
  testId: z.number().int().positive(),
  reason: z.string().trim().min(1, "Say why: whoever releases it needs to know what was wrong.").max(2000),
});

router.post("/api/quarantine", requireRole("editor"), async (req, res) => {
  const parsed = quarantineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  try {
    const row = await withTenantTransaction((tx) =>
      quarantineTest(tx, {
        ref: { type: parsed.data.testType, id: parsed.data.testId },
        reason: parsed.data.reason,
        organizationId: getTenantOrgId()!,
        actor: auditActor(req),
      }),
    );
    res.status(201).json(row);
  } catch (error) {
    fail(res, error, "quarantine the test");
  }
});

router.post("/api/quarantine/:id/release", requireRole("editor"), async (req, res) => {
  const quarantineId = Number(req.params.id);
  const parsed = z.object({ note: z.string().trim().max(2000).optional() }).safeParse(req.body ?? {});
  if (!Number.isInteger(quarantineId) || !parsed.success) return res.status(400).json({ error: "Invalid request" });
  try {
    const row = await withTenantTransaction((tx) =>
      releaseQuarantine(tx, { quarantineId, note: parsed.data.note || null, actor: auditActor(req) }),
    );
    res.json(row);
  } catch (error) {
    fail(res, error, "release the test");
  }
});

export default router;
