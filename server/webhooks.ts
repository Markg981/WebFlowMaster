import { Router } from "express";
import { privilegedDb } from "./db";
import { testPlanWebhooks, testPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runTestPlan } from "./test-execution-service";
import loggerPromise from "./logger";

export const webhooksRouter = Router();

// POST /api/webhooks/execute/:token - Execute a test plan via webhook
webhooksRouter.post("/execute/:token", async (req, res) => {
  const resolvedLogger = await loggerPromise;
  const token = req.params.token;

  if (!token) {
    return res.status(400).json({ success: false, error: "Token is required" });
  }

  try {
    // 1. Validate the webhook token
    const webhookResult = await privilegedDb.select().from(testPlanWebhooks).where(eq(testPlanWebhooks.token, token)).limit(1);
    
    if (webhookResult.length === 0) {
      resolvedLogger.warn({ message: "Invalid webhook token used", token });
      return res.status(401).json({ success: false, error: "Invalid or revoked webhook token" });
    }

    const webhook = webhookResult[0];

    // 2. Update the last used timestamp
    await privilegedDb.update(testPlanWebhooks)
      .set({ lastUsedAt: new Date() })
      .where(eq(testPlanWebhooks.id, webhook.id));

    // 3. Verify the Test Plan still exists
    const planResult = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, webhook.testPlanId)).limit(1);
    if (planResult.length === 0) {
      return res.status(404).json({ success: false, error: "Associated Test Plan no longer exists" });
    }

    // 4. Trigger the execution
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

    // 5. Return success and the run ID so CI can poll for status if it wants to
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
});
