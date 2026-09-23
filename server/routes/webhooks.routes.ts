import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, testPlans, testPlanWebhooks } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { auditActor, recordAudit } from "../audit";
import { generateWebhookToken } from "../webhook-tokens";
import loggerPromise from "../logger";

/**
 * Creating, listing and deleting the webhooks that start a plan from CI.
 *
 * The page for these has existed for a while and called three endpoints that did not: a webhook
 * could be triggered but never created, and the dialog answered every click with a 404.
 *
 * The token leaves the server once, in the response that created it. The row holds its hash, so
 * nobody — including this application — can show it again; a lost token is replaced by deleting
 * the webhook and creating another.
 */

const router = Router();
const logger = await loggerPromise;

const createWebhookSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
});

/** What a listing shows: never the hash, which is still a secret's shadow. */
function toListed(row: typeof testPlanWebhooks.$inferSelect) {
  return {
    id: row.id,
    testPlanId: row.testPlanId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

// GET /api/test-plans/:planId/webhooks — the plan's webhooks, newest first.
router.get("/api/test-plans/:planId/webhooks", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  // No organization predicate: RLS supplies it, so another tenant's plan simply has none.
  const rows = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(testPlanWebhooks)
      .where(eq(testPlanWebhooks.testPlanId, req.params.planId))
      .orderBy(desc(testPlanWebhooks.createdAt)),
  );
  res.json(rows.map(toListed));
});

// POST /api/test-plans/:planId/webhooks — create one, and show its token once.
router.post("/api/test-plans/:planId/webhooks", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = createWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  const { token, tokenHash, tokenPrefix } = generateWebhookToken();
  try {
    const created = await withTenantTransaction(async (tx) => {
      // Under RLS: another organization's plan is not found, so no webhook can be made for it.
      const [plan] = await tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, req.params.planId)).limit(1);
      if (!plan) return null;

      const [row] = await tx
        .insert(testPlanWebhooks)
        .values({
          testPlanId: plan.id,
          // From the session, never the body.
          organizationId: req.user!.organizationId,
          name: parsed.data.name,
          tokenHash,
          tokenPrefix,
        })
        .returning();

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.WEBHOOK_CREATED,
        actor: auditActor(req),
        targetType: 'webhook',
        targetId: String(row.id),
        // The prefix, never the token and never its hash.
        metadata: { name: row.name, testPlanId: plan.id, tokenPrefix },
      });
      return toListed(row);
    });

    if (!created) return res.status(404).json({ error: "Test plan not found." });
    logger.info({ message: 'Webhook created', webhookId: created.id, testPlanId: created.testPlanId, userId: req.user.id });
    // `token` appears here and nowhere else, ever.
    res.status(201).json({ ...created, token });
  } catch (error: any) {
    logger.error({ message: 'Failed to create webhook', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to create the webhook." });
  }
});

// DELETE /api/webhooks/:id — the token stops working at once.
router.delete("/api/webhooks/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid webhook id." });

  try {
    const deleted = await withTenantTransaction(async (tx) => {
      const [row] = await tx.delete(testPlanWebhooks).where(eq(testPlanWebhooks.id, id)).returning();
      if (!row) return null;
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.WEBHOOK_DELETED,
        actor: auditActor(req),
        targetType: 'webhook',
        targetId: String(row.id),
        metadata: { name: row.name, testPlanId: row.testPlanId, tokenPrefix: row.tokenPrefix },
      });
      return toListed(row);
    });

    // Another organization's webhook is not there at all under RLS: the same answer as none.
    if (!deleted) return res.status(404).json({ error: "Webhook not found." });
    res.json(deleted);
  } catch (error: any) {
    logger.error({ message: 'Failed to delete webhook', error: error?.message ?? String(error), webhookId: id });
    res.status(500).json({ error: "Failed to delete the webhook." });
  }
});

export default router;
