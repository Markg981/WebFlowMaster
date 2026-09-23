import { Router, type Request, type Response } from "express";
import { privilegedDb } from "./db";
import { testPlanWebhooks, testPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runTestPlan } from "./test-execution-service";
import loggerPromise from "./logger";
import { hashWebhookToken, webhookTokenFromRequest } from "./webhook-tokens";

export const webhooksRouter = Router();

/**
 * POST /api/webhooks/execute — start a test plan from a CI system.
 *
 * The token goes in `X-Webhook-Token` (or `Authorization: Bearer`). POST /execute/:token, the
 * URL every existing pipeline was given, still works; the request log masks the token in it.
 *
 * The token is matched by its hash: the table no longer holds any token, only what it hashes to.
 */
async function executeWebhook(req: Request, res: Response) {
  const resolvedLogger = await loggerPromise;
  const token = webhookTokenFromRequest(req.headers as Record<string, string | string[] | undefined>, req.params.token);

  if (!token) {
    return res.status(401).json({ success: false, error: "A webhook token is required (X-Webhook-Token header)." });
  }

  try {
    // The tenant-context boundary: the token is what says which organization and plan this
    // call is for, so it is looked up before there is one.
    const webhookResult = await privilegedDb
      .select()
      .from(testPlanWebhooks)
      .where(eq(testPlanWebhooks.tokenHash, hashWebhookToken(token)))
      .limit(1);

    if (webhookResult.length === 0) {
      // Never the token itself: a log line is not where a credential — or somebody's typo of
      // one — should be kept.
      resolvedLogger.warn({ message: "Invalid webhook token used", tokenPrefix: token.slice(0, 12) });
      return res.status(401).json({ success: false, error: "Invalid or revoked webhook token" });
    }

    const webhook = webhookResult[0];

    await privilegedDb.update(testPlanWebhooks)
      .set({ lastUsedAt: new Date() })
      .where(eq(testPlanWebhooks.id, webhook.id));

    const planResult = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, webhook.testPlanId)).limit(1);
    if (planResult.length === 0) {
      return res.status(404).json({ success: false, error: "Associated Test Plan no longer exists" });
    }

    // A webhook has no user behind it, so the run is requested on behalf of the plan's owner.
    // It used to be user 1 — whoever that was, in whichever organization — which put somebody
    // else's name on the run and, now that the requester must belong to the plan's
    // organization, would refuse every webhook outside the first one.
    resolvedLogger.info({ message: `Triggering test plan via webhook`, webhookId: webhook.id, testPlanId: webhook.testPlanId });

    const idempotencyKey = req.get('Idempotency-Key')?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > 255) {
      return res.status(400).json({ success: false, error: "Idempotency-Key must be at most 255 characters." });
    }
    const executionData = await runTestPlan(webhook.testPlanId, planResult[0].userId, {
      trigger: 'webhook',
      idempotencyKey,
    });

    if ('error' in executionData) {
      return res.status(executionData.status || 500).json({ success: false, error: executionData.error });
    }

    // The run's id, so CI can poll for its status if it wants to.
    res.status(202).json({
      success: true,
      message: "Test Plan execution triggered successfully",
      testPlanRunId: executionData.id,
      status: executionData.status
    });
  } catch (error: any) {
    resolvedLogger.error({ message: "Webhook execution failed", error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: "Internal server error during webhook execution" });
  }
}

webhooksRouter.post("/execute", executeWebhook);
webhooksRouter.post("/execute/:token", executeWebhook);
