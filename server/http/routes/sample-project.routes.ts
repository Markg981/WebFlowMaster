import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sharedStore } from '../../platform/middleware/rate-limit-store';
import { asyncRouter } from '../../platform/middleware/async-router';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { auditActor } from '../../tenancy/audit';
import { quotaErrorBody } from '../../tenancy/tenant-quotas';
import logger from '../../platform/logger';
import {
  createSampleProject,
  sampleProjectOffered,
  SampleProjectExistsError,
} from '../../authoring/sample-project';
import { reviewRequired } from '../../authoring/test-publishing';
import { publicExecution } from '../../execution/execution-provenance';
import { requireRole } from '../middleware/require-role';
import { DEMO_SHOP_PATH } from './demo-shop.routes';
import { publicBase } from './sso.routes';

/**
 * POST /api/sample-project — "Start with a sample project": creates the Northwind Shop sample in
 * the requester's organization (server/authoring/sample-project.ts) and, unless asked not to,
 * starts its first plan, so a new organization has a real run to open within a minute.
 */

const router = asyncRouter();

/**
 * The dashboard asks once per visit and creating happens once per organization: 30 a minute for
 * each member is far above either, and below the global session limit.
 */
const sampleProjectLimiter = rateLimit({
  windowMs: 60_000,
  limit: process.env.NODE_ENV === 'test' ? 100_000 : 30,
  store: sharedStore('sample-project'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${(req.user as { id?: number } | undefined)?.id ?? 'anonymous'}`,
  message: { error: 'Too many requests, slow down.' },
});

/**
 * Where the runners reach the demo shop. DEMO_SHOP_URL when the operator set it (a worker that
 * reaches this server by another name than its users do); otherwise this server's public address,
 * and failing that the address the request came in on.
 */
export function demoShopUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DEMO_SHOP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const base = publicBase(req, env);
  return `${base}${DEMO_SHOP_PATH}`;
}

// GET /api/sample-project — whether the dashboard should offer it (an organization with no tests).
router.get(
  '/api/sample-project',
  sampleProjectLimiter,
  requireRole('editor'),
  async (_req, res) => {
    res.json({ offered: await withTenantTransaction((tx) => sampleProjectOffered(tx)) });
  },
);

const bodySchema = z.object({ run: z.boolean().optional().default(true) }).strict();

router.post(
  '/api/sample-project',
  sampleProjectLimiter,
  requireRole('editor'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    let sample;
    try {
      sample = await withTenantTransaction((tx) =>
        createSampleProject(tx, {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          actor: auditActor(req),
          shopUrl: demoShopUrl(req),
        }),
      );
    } catch (error) {
      if (error instanceof SampleProjectExistsError) {
        return res
          .status(409)
          .json({ error: error.message, code: 'sample_exists', projectId: error.projectId });
      }
      const quota = quotaErrorBody(error);
      if (quota) return res.status(429).json(quota);
      throw error;
    }

    if (!parsed.data.run) return res.status(201).json({ ...sample, run: null });

    // Where publishing needs another member's approval, plans run published tests only: a run now
    // would fail every test as unpublished, which is the wrong first impression and not a sample.
    const organizationId = req.user.organizationId;
    if (await withTenantTransaction((tx) => reviewRequired(tx, organizationId))) {
      return res.status(201).json({
        ...sample,
        run: null,
        runError:
          'this organization requires review before tests run. Publish the sample tests, then run its plans.',
      });
    }

    // The project stays even when its first run cannot start (a quota, no runner): the person can
    // start it from the plans page, and the answer says why it did not start here.
    const { runTestPlan } = await import('../../execution/test-execution-service');
    const run = await runTestPlan(sample.firstRunPlanId, req.user.id, {});
    if ('error' in run) {
      logger.warn({
        message: 'Sample project created; its first run did not start',
        error: run.error,
      });
      return res.status(201).json({ ...sample, run: null, runError: run.error });
    }
    res.status(201).json({ ...sample, run: publicExecution(run) });
  },
);

export default router;
