import { billingConfig } from './config';
import { ManualBillingProvider } from './manual';
import type { BillingProvider } from './provider';
import { StripeBillingProvider } from './stripe';

let override: BillingProvider | undefined;

/** The provider the configuration names, built fresh so a changed environment is honoured. */
export function billingProvider(env: NodeJS.ProcessEnv = process.env): BillingProvider {
  if (override) return override;
  const config = billingConfig(env);
  if (config.provider === 'stripe' && config.stripeSecretKey && config.stripeWebhookSecret)
    return new StripeBillingProvider({
      secretKey: config.stripeSecretKey,
      webhookSecret: config.stripeWebhookSecret,
    });
  return new ManualBillingProvider();
}

/** Tests put a fake behind the routes; `undefined` restores the configured one. */
export function setBillingProviderForTest(provider: BillingProvider | undefined): void {
  override = provider;
}
