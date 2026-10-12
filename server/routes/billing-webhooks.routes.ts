import express, { type RequestHandler } from 'express';
import { asyncRouter } from '../platform/middleware/async-router';
import { webhookRateLimit } from '../middleware/rate-limits';
import { billingConfig } from '../tenancy/billing/config';
import { BillingError } from '../tenancy/billing/provider';
import { billingProvider } from '../tenancy/billing/providers';
import { applyWebhookEvent } from '../tenancy/billing/service';
import logger from '../platform/logger';

/**
 * Where the billing provider reports: `POST /api/billing/webhooks/stripe`, the address to
 * register in Stripe's dashboard. Public, like every webhook, and believed only for a body
 * whose signature the endpoint secret verifies (server/tenancy/billing/stripe.ts). The body must reach
 * the verifier byte for byte, so this router parses it raw, mounted before the JSON parser.
 */
const webhookPath = /^\/api\/billing\/webhooks\/[a-z]+\/?$/;
const rawParser = express.raw({ type: () => true, limit: '1mb' });
export const billingWebhookBodyParser: RequestHandler = (req, res, next) => {
  if (req.method === 'POST' && webhookPath.test(req.path)) return rawParser(req, res, next);
  next();
};

export const billingWebhookRouter = asyncRouter();
billingWebhookRouter.post('/api/billing/webhooks/stripe', webhookRateLimit(), async (req, res) => {
  const config = billingConfig();
  // An installation that does not use Stripe has no endpoint here: nothing for a scanner to probe.
  if (config.provider !== 'stripe') return res.status(404).json({ error: 'Not found' });
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid webhook body' });
  try {
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : undefined,
      ]),
    );
    const provider = billingProvider();
    const event = provider.parseWebhook(req.body, headers);
    const outcome = await applyWebhookEvent(event, provider.name);
    if (outcome.ignored)
      logger.info({
        message: 'Billing webhook ignored',
        type: event.type,
        id: event.id,
        why: outcome.ignored,
      });
    return res.json({ received: true, applied: outcome.applied, duplicate: outcome.duplicate });
  } catch (error) {
    if (error instanceof BillingError)
      return res.status(error.status).json({ error: error.message, code: error.code });
    logger.error({ message: 'Billing webhook failed', error: (error as Error)?.message });
    return res.status(500).json({ error: 'Could not record the billing event' });
  }
});
