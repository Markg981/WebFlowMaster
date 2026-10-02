-- Provisioning with SCIM 2.0 (server/scim.ts): the identity provider creates, changes, deactivates
-- and removes accounts, and pushes its groups, whose names role mappings match (shared/sso-roles.ts).
--
-- The provider's token is stored as its SHA-256, like an API key; it lives with the single sign-on
-- settings, and goes with them. No row security and no grant to app_user on the new tables, like
-- the other single sign-on tables: the token names the organization before any tenant exists, and
-- server/scim.ts names it in every statement. Rows referring to a person go with the account.
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "scim_token_hash" text;
--> statement-breakpoint
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "scim_token_prefix" text;
--> statement-breakpoint
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "scim_token_created_at" timestamp;
--> statement-breakpoint
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "scim_token_last_used_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_sso_scim_token_hash_idx" ON "organization_sso" ("scim_token_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scim_users" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "external_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scim_users_organization_id_idx" ON "scim_users" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scim_groups" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "external_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scim_groups_organization_id_idx" ON "scim_groups" ("organization_id");
--> statement-breakpoint
-- A group's name is unique within the organization, without regard to case: it is what a role mapping names.
CREATE UNIQUE INDEX IF NOT EXISTS "scim_groups_organization_name_idx" ON "scim_groups" ("organization_id", lower("display_name"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scim_group_members" (
  "group_id" text NOT NULL REFERENCES "scim_groups"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "scim_group_members_pkey" PRIMARY KEY ("group_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scim_group_members_user_id_idx" ON "scim_group_members" ("user_id");
