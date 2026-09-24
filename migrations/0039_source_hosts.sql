-- Source hosts (server/commit-status.ts): the GitHub or GitLab an organization's code lives on, with
-- a token allowed to set commit statuses. A run a pipeline started carries its repository and commit
-- (test_plan_executions.ci_context), and the server reports on that commit as the run goes: pending,
-- then passed or failed, with the link to the report.
--
-- The token is encrypted as an issue tracker's is, and never sent back to a client. One host per
-- provider per organization: a run says which provider it came from, not which of several tokens.
CREATE TABLE "source_hosts" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "provider" text NOT NULL,
  "api_url" text NOT NULL,
  "encrypted_token" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_auth_tag" text NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_delivery_at" timestamp,
  "last_delivery_error" text,
  CONSTRAINT "source_hosts_provider_known" CHECK ("provider" IN ('github', 'gitlab')),
  CONSTRAINT "source_hosts_api_url_http" CHECK ("api_url" ~ '^https?://')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_hosts_organization_provider_idx" ON "source_hosts" ("organization_id", "provider");
--> statement-breakpoint
ALTER TABLE "source_hosts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_hosts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "source_hosts"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "source_hosts" TO app_user;
