import { Router, type Response } from 'express';
import { z } from 'zod';
import { BILLING_INTERVALS, SUBSCRIPTION_STATUSES } from '@shared/billing';
import { requireInstallationAdmin } from '../installation-admin';
import { auditActor } from '../audit';
import { BillingError } from '../billing/provider';
import {
  administerSubscription,
  createPlan,
  listOrganizationBilling,
  listPlans,
  updatePlan,
} from '../billing/service';

/**
 * The installation administrator's side of billing: the plan catalogue, and every
 * organization's subscription — which is the whole of billing when BILLING_PROVIDER=none, and
 * the manual override when a provider is configured. Guarded like quota administration
 * (server/routes/tenant-quota-admin.routes.ts).
 */
const router = Router();
const root = '/api/installation/billing';
router.use(
  root,
  (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  },
  requireInstallationAdmin,
);

function fail(res: Response, error: unknown) {
  if (error instanceof BillingError)
    return res.status(error.status).json({ error: error.message, code: error.code });
  throw error;
}

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const quotasSchema = z
  .object({
    maxConcurrentRuns: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
    maxQueuedRuns: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
    maxTests: count.optional(),
    maxArtifactBytes: count.optional(),
    maxMonthlyExecutionMinutes: count.optional(),
  })
  .strict();
const priceIdsSchema = z
  .object({
    month: z.string().min(1).max(200).optional(),
    year: z.string().min(1).max(200).optional(),
  })
  .strict();
const planFields = {
  name: z.string().trim().min(1).max(120),
  priceMonthMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  priceYearMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[a-z]{3}$/),
  trialDays: z.number().int().min(0).max(3650),
  active: z.boolean(),
  quotas: quotasSchema,
  providerPriceIds: priceIdsSchema,
};
const planCreateSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    name: planFields.name,
    priceMonthMinor: planFields.priceMonthMinor.optional(),
    priceYearMinor: planFields.priceYearMinor.optional(),
    currency: planFields.currency.optional(),
    trialDays: planFields.trialDays.optional(),
    active: planFields.active.optional(),
    quotas: quotasSchema.optional(),
    providerPriceIds: priceIdsSchema.optional(),
  })
  .strict();
const planPatchSchema = z
  .object({
    name: planFields.name.optional(),
    priceMonthMinor: planFields.priceMonthMinor.optional(),
    priceYearMinor: planFields.priceYearMinor.optional(),
    currency: planFields.currency.optional(),
    trialDays: planFields.trialDays.optional(),
    active: planFields.active.optional(),
    quotas: quotasSchema.optional(),
    providerPriceIds: priceIdsSchema.optional(),
  })
  .strict();
const isoDate = z
  .string()
  .datetime()
  .transform((value) => new Date(value))
  .nullable();
const subscriptionPatchSchema = z
  .object({
    planCode: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
      .optional(),
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    suspendedReason: z.string().trim().max(500).nullable().optional(),
    trialEndsAt: isoDate.optional(),
    currentPeriodEnd: isoDate.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change' });
const querySchema = z.object({
  search: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const idSchema = z.coerce.number().int().min(1).max(2_147_483_647);
const codeSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

router.get(`${root}/plans`, async (_req, res, next) => {
  try {
    res.json({ items: await listPlans(false), intervals: BILLING_INTERVALS });
  } catch (error) {
    next(error);
  }
});
router.post(`${root}/plans`, async (req, res, next) => {
  const body = planCreateSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid plan' });
  try {
    res.status(201).json(await createPlan(body.data));
  } catch (error) {
    try {
      fail(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});
router.patch(`${root}/plans/:code`, async (req, res, next) => {
  const code = codeSchema.safeParse(req.params.code);
  const body = planPatchSchema.safeParse(req.body);
  if (!code.success || !body.success) return res.status(400).json({ error: 'Invalid plan' });
  try {
    res.json(await updatePlan(code.data, body.data));
  } catch (error) {
    try {
      fail(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});
router.get(`${root}/organizations`, async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
  try {
    res.json(
      await listOrganizationBilling(parsed.data.search, parsed.data.limit, parsed.data.offset),
    );
  } catch (error) {
    next(error);
  }
});
router.patch(`${root}/organizations/:id`, async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const body = subscriptionPatchSchema.safeParse(req.body);
  if (!id.success || !body.success)
    return res.status(400).json({ error: 'Invalid subscription change' });
  try {
    res.json(await administerSubscription(id.data, body.data, auditActor(req)));
  } catch (error) {
    try {
      fail(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

export default router;
