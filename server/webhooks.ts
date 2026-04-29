import { Router } from "express";
import { db } from "./db";
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
    const webhookResult = await db.select().from(testPlanWebhooks).where(eq(testPlanWebhooks.token, token)).limit(1);
    
    if (webhookResult.length === 0) {
      resolvedLogger.warn({ message: "Invalid webhook token used", token });
      return res.status(401).json({ success: false, error: "Invalid or revoked webhook token" });
    }

    const webhook = webhookResult[0];

    // 2. Update the last used timestamp
    await db.update(testPlanWebhooks)
      .set({ lastUsedAt: new Date() })
      .where(eq(testPlanWebhooks.id, webhook.id));

    // 3. Verify the Test Plan still exists
    const planResult = await db.select().from(testPlans).where(eq(testPlans.id, webhook.testPlanId)).limit(1);
    if (planResult.length === 0) {
      return res.status(404).json({ success: false, error: "Associated Test Plan no longer exists" });
    }

    // 4. Trigger the execution
    // Since it's a webhook, we might not have a specific user context. 
    // We could pass an automated user ID (e.g. 0 or a generic SYSTEM user), 
    // but for now we will pass a placeholder (1) or get it from the plan owner if multi-tenancy exists.
    resolvedLogger.info({ message: `Triggering test plan via webhook`, webhookId: webhook.id, testPlanId: webhook.testPlanId });
    
    const executionData = await runTestPlan(webhook.testPlanId, 1); 

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
