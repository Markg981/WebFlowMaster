-- Per-provider "trust unverified e-mail" for OpenID Connect sign-in (audit A-05).
--
-- Until now a token without email_verified was believed, and an address-shaped preferred_username
-- stood in for a missing email: motivated by Entra ID, but a hole for any other provider. Both are
-- now off unless the provider's flag is on. To keep existing Entra ID setups working, providers
-- already configured with a Microsoft issuer (login.microsoftonline.com, sts.windows.net) get the
-- flag set to true here; every other provider starts false and must send email_verified = true.
-- SAML providers are not affected (the signed assertion is the proof).
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "trust_unverified_email" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "organization_sso" SET "trust_unverified_email" = true
WHERE "protocol" = 'oidc' AND ("issuer" ILIKE '%login.microsoftonline.com%' OR "issuer" ILIKE '%sts.windows.net%');
