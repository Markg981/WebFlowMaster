-- Roles from the identity provider's groups, and DNS proof of e-mail domains (shared/sso-roles.ts).
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "group_attribute" text;
--> statement-breakpoint
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "role_mappings" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "require_group" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sso_domains" ADD COLUMN IF NOT EXISTS "verification_token" text;
--> statement-breakpoint
ALTER TABLE "sso_domains" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;
--> statement-breakpoint
-- Domains claimed before this release get a token now, so their owners can prove them.
UPDATE "sso_domains" SET "verification_token" = md5(random()::text || clock_timestamp()::text || "domain") WHERE "verification_token" IS NULL;
