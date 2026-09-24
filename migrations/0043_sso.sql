-- Single sign-on with OpenID Connect, per organization (server/sso.ts).
--
-- organization_sso holds an organization's identity provider: its issuer, the client the
-- organization registered there, the client secret (AES-256-GCM, like environment secrets), the
-- role an account created on first sign-in gets, and whether members must sign in this way.
--
-- sso_domains says which organization's provider signs in an e-mail address: the sign-in page
-- asks for the address, and its domain picks the organization. The domain is the primary key, so
-- two organizations cannot both claim one.
--
-- sso_identities remembers which account an identity at a provider is — the issuer and its
-- stable subject, not the e-mail address, which people change. It goes with the account.
--
-- No row security and no grant to app_user, like user_mfa: the provider for a domain is looked up
-- before anyone is signed in, which no tenant transaction can do. They are reached only by
-- server/sso.ts, which names the organization in every statement.
CREATE TABLE "organization_sso" (
  "organization_id" integer PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "issuer" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_encrypted" text NOT NULL,
  "client_secret_iv" text NOT NULL,
  "client_secret_auth_tag" text NOT NULL,
  "default_role" text DEFAULT 'viewer' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  -- Never owner: an identity provider handing out ownership of an organization is one
  -- misconfigured group away from giving it to everybody.
  CONSTRAINT "organization_sso_default_role_check" CHECK ("default_role" IN ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "sso_domains" (
  "domain" text PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "sso_domains_lower_case" CHECK ("domain" = lower("domain"))
);
--> statement-breakpoint
CREATE INDEX "sso_domains_organization_id_idx" ON "sso_domains" ("organization_id");
--> statement-breakpoint
CREATE TABLE "sso_identities" (
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_sign_in_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sso_identities_pkey" PRIMARY KEY ("issuer", "subject"),
  CONSTRAINT "sso_identities_user_id_unique" UNIQUE ("user_id")
);
