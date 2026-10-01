-- Single sign-on with SAML 2.0, next to OpenID Connect (server/sso.ts, server/sso-saml.ts).
--
-- Many companies' identity providers speak only SAML (ADFS, older Okta and Ping set-ups, Shibboleth).
-- An organization still has one provider; `protocol` says which language it speaks. For SAML:
--
--   issuer            the identity provider's entity ID (what its assertions name as Issuer)
--   saml_sso_url      where the browser is sent with the AuthnRequest (HTTP-Redirect binding)
--   saml_certificate  the provider's signing certificate, PEM — public, so stored as it is
--
-- and there is no client id or secret, so those columns become optional. A check keeps each
-- protocol's own columns filled.
ALTER TABLE "organization_sso"
  ADD COLUMN "protocol" text DEFAULT 'oidc' NOT NULL,
  ADD COLUMN "saml_sso_url" text,
  ADD COLUMN "saml_certificate" text;
--> statement-breakpoint
ALTER TABLE "organization_sso" ALTER COLUMN "client_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_sso" ALTER COLUMN "client_secret_encrypted" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_sso" ALTER COLUMN "client_secret_iv" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_sso" ALTER COLUMN "client_secret_auth_tag" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_sso" ADD CONSTRAINT "organization_sso_protocol_check" CHECK (
  ("protocol" = 'oidc' AND "client_id" IS NOT NULL AND "client_secret_encrypted" IS NOT NULL)
  OR ("protocol" = 'saml' AND "saml_sso_url" IS NOT NULL AND "saml_certificate" IS NOT NULL)
);
--> statement-breakpoint
-- The AuthnRequests this installation sent and is still waiting for. A response is accepted only if
-- it answers one of them (InResponseTo), and answering removes it — so a response cannot be replayed
-- and an unsolicited one is refused. In the database rather than in the session, because the
-- provider's POST back is cross-site and the SameSite=Lax session cookie does not travel with it;
-- and rather than in memory, because the POST may reach another web server.
--
-- No row security and no grant to app_user, like the other sso tables.
CREATE TABLE "sso_saml_requests" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sso_saml_requests_created_at_idx" ON "sso_saml_requests" ("created_at");
