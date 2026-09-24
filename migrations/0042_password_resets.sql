-- Password resets (server/password-reset.ts): a one-time link an owner issues for a member who
-- cannot sign in, since the application sends no e-mail. Before this, nobody could change a
-- password at all, their own or anyone else's.
--
-- The token is 32 random bytes shown once, in the link, and stored only as its SHA-256, like an
-- API key. A reset lasts 24 hours and is used at most once; issuing a new one for the same person
-- replaces the old.
--
-- Org-scoped and policed like the rest: an owner issues and lists resets inside their organization.
-- Redeeming one happens before anyone is signed in, so that single lookup is privileged, in
-- server/storage.ts, the same bootstrap shape as accepting an invitation.
CREATE TABLE "password_resets" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  -- The person's own: it goes with the account.
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  -- Who issued it; null for the operator's command line, or once that owner's account is gone.
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "password_resets_token_hash_unique" UNIQUE ("token_hash")
);
--> statement-breakpoint
-- The person a link is for is in the link's organization, as for API keys (migration 0034).
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_same_org_fk"
  FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id");
--> statement-breakpoint
CREATE INDEX "password_resets_organization_id_idx" ON "password_resets" ("organization_id");
--> statement-breakpoint
CREATE INDEX "password_resets_user_id_idx" ON "password_resets" ("user_id");
--> statement-breakpoint
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "password_resets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "password_resets"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "password_resets" TO app_user;
