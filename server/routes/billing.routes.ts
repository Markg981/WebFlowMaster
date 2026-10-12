import { type Request, type Response } from 'express';
import { asyncRouter } from '../platform/middleware/async-router';
import { z } from 'zod';
import { BILLING_INTERVALS } from '@shared/billing';
import { requireRole } from '../middleware/require-role';
import { getTenantOrgId } from '../platform/middleware/tenancy';
import { billingConfig } from '../tenancy/billing/config';
import { BillingError } from '../tenancy/billing/provider';
import { billingSummary, listPlans, openPortal, startCheckout } from '../tenancy/billing/service';
import { publicBase } from './sso.routes';

/**
 * An organization's own view of its billing: the plan it is on, where it stands, what it uses
 * — and, with a provider configured, the way to pay. Reading is every member's: the banner that
 * says the organization is suspended is for everybody. Paying is an owner's.
 */
const router = asyncRouter();

function fail(res: Response, error: unknown) {
  if (error instanceof BillingError)
    return res.status(error.status).json({ error: error.message, code: error.code });
  throw error;
}

/** Where the provider sends the browser back: the configured address, else this request's. */
function returnBase(req: Request): string {
  return billingConfig().publicBaseUrl ?? publicBase(req);
}

router.get('/api/billing', requireRole('viewer'), async (_req, res, next) => {
  try {
    res.json(await billingSummary(getTenantOrgId()!));
  } catch (error) {
    try {
      fail(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

router.get('/api/billing/plans', requireRole('viewer'), async (_req, res, next) => {
  try {
    res.json({ items: await listPlans(true), provider: billingConfig().provider });
  } catch (error) {
    next(error);
  }
});

const checkoutSchema = z
  .object({
    planCode: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    interval: z.enum(BILLING_INTERVALS),
  })
  .strict();

router.post('/api/billing/checkout', requireRole('owner'), async (req, res, next) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid checkout request' });
  try {
    res.json(
      await startCheckout({
        organizationId: getTenantOrgId()!,
        planCode: parsed.data.planCode,
        interval: parsed.data.interval,
        userId: req.user!.id,
        baseUrl: returnBase(req),
      }),
    );
  } catch (error) {
    try {
      fail(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

router.post('/api/billing/portal', requireRole('owner'), async (req, res, next) => {
  try {
    res.json(await openPortal(getTenantOrgId()!, returnBase(req)));
  } catch (error) {
    try {
      fail(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

export default router;
