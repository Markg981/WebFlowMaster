import { asyncRouter } from '../platform/middleware/async-router';
import { type Response } from 'express';
import { z } from 'zod';
import {
  AdhocDetectedElementSchema,
  AdhocTestStepSchema,
  CleanupSchema,
  PreconditionSchema,
} from '@shared/schema';
import { sharedSetIdOf } from '@shared/test-data';
import { BrowserTaskError, browserTasks } from '../web/browser-tasks';
import logger from '../platform/logger';
import { asyncHandler } from '../platform/middleware/async-handler';
import { sharedHeavyRateLimit } from '../middleware/rate-limits';
import { requireRole } from '../middleware/require-role';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import type { playwrightService } from '../web/playwright-service';
import { SharedDataError, expandSharedDataset } from '../authoring/test-data';
import { quotaErrorBody, quotaErrorStatus } from '../tenancy/tenant-quotas';

/**
 * The editor's one-off browser work: loading a page to author against, surveying its
 * elements, and running the sequence being written. Each goes through the browser task
 * queue (server/web/browser-tasks.ts), which decides where the browser runs.
 */

const router = asyncRouter();
// After requireRole, so it counts for the user the role check has already established.
const heavyLimit = sharedHeavyRateLimit();

const urlBodySchema = z.object({ url: z.string().url({ message: 'Invalid URL' }) });

const executeDirectTestSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  sequence: z.array(AdhocTestStepSchema),
  elements: z.array(AdhocDetectedElementSchema),
  // Preconditions are part of a saved test and are run by the scheduled runner, so the
  // ad-hoc preview must accept and run them too — otherwise "Execute Test" exercises a
  // different setup than the real run.
  preconditions: z.array(PreconditionSchema).optional().nullable(),
  // And cleaned up after, as a saved run is (server/runtime/cleanup-runner.ts).
  cleanups: z.array(CleanupSchema).max(50).optional().nullable(),
  // Which environment resolves `{{name}}` placeholders. The organization it must belong
  // to is taken from the session, so naming another tenant's environment resolves nothing.
  environmentId: z.number().int().positive().optional().nullable(),
  // Rows the preview runs over, so it runs as many times as the saved test will.
  dataset: z.array(z.record(z.string())).optional().nullable(),
});

/**
 * Answers the two refusals a browser task has its own words for: the organization is out
 * of quota, or the queue said no (no agent, too busy). Anything else is rethrown for the
 * error middleware. `extra` is merged into the refusal so each endpoint keeps its shape.
 */
function answerRefusal(error: unknown, res: Response, extra: Record<string, unknown> = {}) {
  const quota = quotaErrorBody(error);
  if (quota) return res.status(quotaErrorStatus(error)).json(quota);
  if (error instanceof BrowserTaskError) {
    return res
      .status(error.status)
      .json({ success: false, error: error.message, code: error.code, ...extra });
  }
  throw error;
}

function invalidPayload(res: Response, error: z.ZodError) {
  return res
    .status(400)
    .json({ success: false, error: 'Invalid request payload', details: error.flatten() });
}

router.post(
  '/api/load-website',
  requireRole('editor'),
  heavyLimit,
  asyncHandler(async (req, res) => {
    const parseResult = urlBodySchema.safeParse(req.body);
    if (!parseResult.success) return invalidPayload(res, parseResult.error);
    const { url } = parseResult.data;

    type Loaded = Awaited<ReturnType<typeof playwrightService.loadWebsite>>;
    let result: Loaded;
    try {
      result = await browserTasks.run<Loaded>({
        task: { kind: 'load-website', url },
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
      });
    } catch (error) {
      return answerRefusal(error, res);
    }

    if (!result.success) {
      logger.error({
        message: 'POST /api/load-website - the page did not load',
        error: result.error,
        url,
      });
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to load website using Playwright service.',
      });
    }
    res.json({ success: true, screenshot: result.screenshot, html: result.html });
  }),
);

router.post(
  '/api/detect-elements',
  requireRole('editor'),
  heavyLimit,
  asyncHandler(async (req, res) => {
    const parseResult = urlBodySchema.safeParse(req.body);
    if (!parseResult.success) return invalidPayload(res, parseResult.error);
    const { url } = parseResult.data;

    type Detection = Awaited<ReturnType<typeof playwrightService.detectElements>>;
    let detection: Detection;
    try {
      detection = await browserTasks.run<Detection>({
        task: { kind: 'detect-elements', url },
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
      });
    } catch (error) {
      return answerRefusal(error, res);
    }

    // The screenshot travels with the elements so the preview and the boxes drawn on it
    // come from one page load. `summary` lets the panel say "showing 300 of 812" rather
    // than presenting a truncated list as though it were the whole page.
    res.json({
      success: true,
      elements: detection.elements,
      screenshot: detection.screenshot,
      summary: detection.summary,
    });
  }),
);

router.post(
  '/api/execute-test-direct',
  requireRole('editor'),
  asyncHandler(async (req, res) => {
    const parseResult = executeDirectTestSchema.safeParse(req.body);
    if (!parseResult.success) return invalidPayload(res, parseResult.error);

    // A test running over a shared data set runs over its rows here too (shared/test-data.ts).
    let payload = parseResult.data;
    try {
      if (sharedSetIdOf(payload.dataset) !== null)
        payload = await withTenantTransaction((tx) => expandSharedDataset(tx, parseResult.data));
    } catch (error) {
      if (error instanceof SharedDataError)
        return res.status(400).json({ success: false, error: error.message });
      throw error;
    }

    // Partial: the task may come back from an agent, so its shape is checked below.
    let result: Partial<Awaited<ReturnType<typeof playwrightService.executeAdhocSequence>>>;
    try {
      // organizationId comes from the session, not the payload: the schema does not accept
      // it, so a client cannot name a tenant whose environment secrets it would resolve.
      result = await browserTasks.run<typeof result>({
        task: { kind: 'adhoc-sequence', payload },
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
      });
    } catch (error) {
      return answerRefusal(error, res, { steps: [], duration: 0 });
    }

    logger.http({
      message: 'POST /api/execute-test-direct - Handler complete.',
      userId: req.user!.id,
      testName: payload.name,
      overallSuccess: result?.success,
      stepsReturned: result?.steps?.length,
      error: result?.success ? undefined : result?.error,
    });

    if (typeof result?.success !== 'boolean') {
      logger.error({
        message: 'POST /api/execute-test-direct - Unexpected structure from the ad-hoc run.',
        result,
        testName: payload.name,
      });
      return res.status(500).json({
        success: false,
        error: 'Internal server error: Unexpected response from test execution service.',
        steps: [],
        detection: undefined,
        duration: 0,
      });
    }
    res.json(result);
  }),
);

export default router;
