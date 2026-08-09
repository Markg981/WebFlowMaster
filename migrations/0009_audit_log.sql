-- Append-only record of who changed what, within one organization.
--
-- Two things make this evidence rather than just another log table.
--
-- It is append-only at the database level: app_user gets SELECT and INSERT and nothing else,
-- so the application physically cannot rewrite or erase an entry. A log the application can
-- edit proves nothing about what happened.
--
-- And entries are written inside the transaction that makes the change they describe, so the
-- two commit or roll back together — see server/audit.ts.
--
-- actor_user_id is ON DELETE SET NULL and actor_username is denormalised alongside it:
-- removing a member must neither erase what they did nor be blocked by it, and the entry has
-- to keep naming someone after the account is gone.
CREATE TABLE "audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "actor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_username" text,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_organization_id_idx" ON "audit_log" ("organization_id");
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");
--> statement-breakpoint

-- Same isolation as every other org-scoped table: FORCE so the table owner is subject to the
-- policy too, and NULLIF so a connection with no organization bound sees nothing rather than
-- raising a cast error on the empty-string GUC default (Postgres bug #15646).
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "audit_log"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint

-- The narrow grant is the point. Deliberately no UPDATE and no DELETE: not "we don't do that",
-- but "we cannot". Retention pruning, if it is ever needed, is a job for a privileged
-- maintenance task, not for the request path.
GRANT SELECT, INSERT ON TABLE "audit_log" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "audit_log_id_seq" TO app_user;
