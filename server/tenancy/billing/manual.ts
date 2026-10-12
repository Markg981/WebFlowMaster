import { BillingError, type BillingProvider } from './provider';

/**
 * No provider: the self-hosted default. The installation administrator puts organizations on
 * plans and moves them between statuses by hand (PATCH /api/installation/billing/organizations/:id);
 * nobody is sent anywhere to pay, and no webhook is believed.
 */
export class ManualBillingProvider implements BillingProvider {
  readonly name = 'none' as const;

  async createCheckoutSession(): Promise<{ url: string }> {
    throw new BillingError(
      409,
      'billing_provider_unavailable',
      'This installation has no billing provider: plans are managed by the installation administrator.',
    );
  }

  async createPortalSession(): Promise<{ url: string }> {
    throw new BillingError(
      409,
      'billing_provider_unavailable',
      'This installation has no billing provider: plans are managed by the installation administrator.',
    );
  }

  parseWebhook(): never {
    throw new BillingError(
      404,
      'billing_provider_unavailable',
      'No billing provider is configured.',
    );
  }

  async cancel(): Promise<void> {
    /* Nothing to end at a provider: the status is the administrator's to set. */
  }
}
