-- Where a failure goes once somebody has to do something about it.

-- 1. The tracker an organization files its bugs in.
--
-- A failed run ended here. Somebody read the report, opened Jira or Azure DevOps in another
-- tab, retyped the test name, the browser, the error and a link, and then did it again the
-- next morning for the same failure — because nothing on either side knew the two were the
-- same thing. The work that gets skipped when it is that tedious is the filing, which is how
-- a suite ends up with failures nobody is tracking and a board that does not know they exist.
--
-- The token is encrypted with the same AES-256-GCM scheme as `secrets`, for the same reason:
-- it is a credential for a system this one does not own. It is never sent back to a client —
-- the API answers with the tracker and a hint of who it authenticates as, never the token.
CREATE TABLE "issue_trackers" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  -- What a person calls it: "Jira — Shop", "ADO — Platform".
  "name" text NOT NULL,
  -- 'jira' | 'azure_devops'. A closed list in the application (see server/issue-providers.ts),
  -- because a provider with no implementation would be a tracker that silently files nothing.
  "provider" text NOT NULL,
  -- https://acme.atlassian.net, or https://dev.azure.com/acme.
  "base_url" text NOT NULL,
  -- The Jira project key (SHOP), or the Azure DevOps project name.
  "project_key" text NOT NULL,
  -- Jira issue type or ADO work item type. 'Bug' unless somebody says otherwise.
  "issue_type" text DEFAULT 'Bug' NOT NULL,
  -- Jira authenticates an API token against an account's email; Azure DevOps ignores it.
  "user_email" text,
  "encrypted_token" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_auth_tag" text NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "issue_trackers_organization_id_idx" ON "issue_trackers" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "issue_trackers_organization_name_unique" ON "issue_trackers" ("organization_id", lower("name"));
--> statement-breakpoint
ALTER TABLE "issue_trackers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "issue_trackers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "issue_trackers"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "issue_trackers" TO app_user;
--> statement-breakpoint

-- 2. Which failure produced which issue.
--
-- The whole point of writing this down is not filing the same bug twice. A nightly plan that
-- fails for a week would otherwise open seven identical issues, and the eighth morning nobody
-- reads any of them. `dedupe_key` is what "the same failure" means here — this plan, this
-- test, this browser — so the second occurrence becomes a comment on the issue that already
-- exists, and the count of occurrences becomes the thing that says how bad it is.
--
-- Every reference is ON DELETE SET NULL rather than CASCADE. A deleted plan, test or purged
-- execution must not erase the record that an issue was filed: that issue still exists in Jira,
-- and a link table that forgets it is how a duplicate gets opened.
CREATE TABLE "issue_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "tracker_id" text NOT NULL REFERENCES "issue_trackers"("id") ON DELETE CASCADE,
  "dedupe_key" text NOT NULL,
  "test_plan_id" text REFERENCES "test_plans"("id") ON DELETE SET NULL,
  "ui_test_id" integer REFERENCES "tests"("id") ON DELETE SET NULL,
  -- Kept as text as well as by id: the name is what the issue says, and it has to stay
  -- readable after the test itself is gone.
  "test_name" text NOT NULL,
  "browser" text,
  "issue_key" text NOT NULL,
  "issue_url" text NOT NULL,
  "first_execution_id" text REFERENCES "test_plan_executions"("id") ON DELETE SET NULL,
  "last_execution_id" text REFERENCES "test_plan_executions"("id") ON DELETE SET NULL,
  "occurrences" integer DEFAULT 1 NOT NULL,
  -- Set when the test passed again. Local knowledge only: whether the issue is closed is the
  -- tracker's business, and claiming to know would be claiming more than this can see.
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "issue_links_organization_id_idx" ON "issue_links" ("organization_id");
--> statement-breakpoint
CREATE INDEX "issue_links_tracker_id_idx" ON "issue_links" ("tracker_id");
--> statement-breakpoint
CREATE INDEX "issue_links_test_plan_id_idx" ON "issue_links" ("test_plan_id");
--> statement-breakpoint
CREATE INDEX "issue_links_last_execution_id_idx" ON "issue_links" ("last_execution_id");
--> statement-breakpoint
-- One open issue per failure, per tracker. This is the constraint the whole feature rests on.
CREATE UNIQUE INDEX "issue_links_tracker_dedupe_unique" ON "issue_links" ("tracker_id", "dedupe_key");
--> statement-breakpoint
ALTER TABLE "issue_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "issue_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "issue_links"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "issue_links" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "issue_links_id_seq" TO app_user;
--> statement-breakpoint

-- 3. Which plan files where, and whether it files at all.
--
-- Off by default, and off for every plan that exists: filing a bug is an action in somebody
-- else's system, and a feature that starts doing that on its own the moment it is deployed
-- would be a feature nobody forgave. A plan opts in, and names the tracker it opts into.
ALTER TABLE "test_plans" ADD COLUMN "issue_tracker_id" text REFERENCES "issue_trackers"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "test_plans" ADD COLUMN "create_issues_on_failure" boolean DEFAULT false NOT NULL;
