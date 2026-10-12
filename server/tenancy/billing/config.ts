import { BILLING_PROVIDERS, type BillingProviderName } from '@shared/billing';
import { publicBaseUrl } from '../../report-links';

/**
 * How billing is configured, from the environment each time it is asked: an operator's change
 * in a test is seen at once, and there is no cached copy to be wrong.
 *
 * - BILLING_PROVIDER: `none` (default) — the installation administrator sets plans and statuses
 *   by hand, which is what a self-hosted installation wants — or `stripe`.
 * - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: both required with `stripe`; the second is what
 *   makes a webhook believable (server/tenancy/billing/stripe.ts).
 * - BILLING_PUBLIC_BASE_URL: where the provider sends the browser back after checkout or the
 *   portal; WEBFLOW_PUBLIC_URL when unset, and with `stripe` one of them must be set — a return
 *   to `localhost` would strand the customer on the provider's page.
 * - BILLING_PAST_DUE_GRACE_DAYS: how long a past_due subscription keeps starting runs (7).
 */
export interface BillingConfig {
  provider: BillingProviderName;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  publicBaseUrl: string | undefined;
  pastDueGraceDays: number;
}

export const DEFAULT_PAST_DUE_GRACE_DAYS = 7;

export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const rawProvider = (env.BILLING_PROVIDER ?? 'none').trim().toLowerCase() || 'none';
  if (!BILLING_PROVIDERS.includes(rawProvider as BillingProviderName))
    throw new Error(`BILLING_PROVIDER must be one of ${BILLING_PROVIDERS.join(', ')}.`);
  const provider = rawProvider as BillingProviderName;
  const grace = Number(env.BILLING_PAST_DUE_GRACE_DAYS ?? '');
  const pastDueGraceDays =
    env.BILLING_PAST_DUE_GRACE_DAYS?.trim() && Number.isInteger(grace) && grace >= 0 && grace <= 365
      ? grace
      : DEFAULT_PAST_DUE_GRACE_DAYS;
  const base = env.BILLING_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  return {
    provider,
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    publicBaseUrl: base || publicBaseUrl(),
    pastDueGraceDays,
  };
}

/** At startup: a half-configured Stripe fails here, not at the first customer's checkout. */
export function assertBillingConfigured(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const config = billingConfig(env);
  if (config.provider === 'stripe') {
    if (!config.stripeSecretKey || !config.stripeWebhookSecret)
      throw new Error(
        'BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (docs/en/admin/administration.md, "Billing").',
      );
    if (!config.publicBaseUrl)
      throw new Error(
        'BILLING_PROVIDER=stripe needs BILLING_PUBLIC_BASE_URL or WEBFLOW_PUBLIC_URL, the address Stripe sends customers back to.',
      );
  }
  return config;
}
