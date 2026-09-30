-- Test management tools: TestRail, Xray and Zephyr Scale (shared/test-management.ts).
--
-- QA teams keep their test cases and their release sign-off in one of these, and the results of
-- automated runs had to be copied there by hand. A connection is the tool and the account; each
-- test says which case it is there; a plan that names a connection publishes every finished run
-- to it — a TestRail run, an Xray Test Execution, a Zephyr test cycle — and the report says where.
--
-- The token (TestRail API key, Xray client secret or personal access token, Zephyr API token) is
-- encrypted like an issue tracker's and never sent back.
CREATE TABLE "test_management_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  -- 'testrail' | 'xray_cloud' | 'xray_server' | 'zephyr_scale'.
  "provider" text NOT NULL,
  "base_url" text NOT NULL,
  -- TestRail's user, Xray Cloud's client id, or an Xray Server user for basic authentication.
  "username" text,
  -- TestRail's project id, or the Jira project key of Xray and Zephyr.
  "project_key" text NOT NULL,
  -- TestRail's suite id, for a project with several suites.
  "suite_id" text,
  -- An Xray Test Plan every published execution is added to.
  "test_plan_key" text,
  "encrypted_token" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_auth_tag" text NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_management_connections_provider_known" CHECK ("provider" IN ('testrail', 'xray_cloud', 'xray_server', 'zephyr_scale')),
  CONSTRAINT "test_management_connections_id_organization_unique" UNIQUE ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "test_management_connections_organization_id_idx" ON "test_management_connections" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "test_management_connections_organization_name_unique" ON "test_management_connections" ("organization_id", lower("name"));
--> statement-breakpoint
-- Which case in the tool a test is: C123 in TestRail, SHOP-45 in Xray, SHOP-T12 in Zephyr Scale.
CREATE TABLE "test_case_links" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "connection_id" text NOT NULL REFERENCES "test_management_connections"("id") ON DELETE CASCADE,
  "test_type" text NOT NULL,
  "test_id" integer REFERENCES "tests"("id") ON DELETE CASCADE,
  "api_test_id" integer REFERENCES "api_tests"("id") ON DELETE CASCADE,
  "case_key" text NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_case_links_one_test" CHECK (
    ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL)
    OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "test_case_links_connection_id_idx" ON "test_case_links" ("connection_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_links_ui_unique" ON "test_case_links" ("connection_id", "test_id") WHERE "test_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_links_api_unique" ON "test_case_links" ("connection_id", "api_test_id") WHERE "api_test_id" IS NOT NULL;
--> statement-breakpoint
-- Each time a run was published, where to, and what came of it.
CREATE TABLE "test_management_publications" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "test_plan_execution_id" text NOT NULL REFERENCES "test_plan_executions"("id") ON DELETE CASCADE,
  "connection_id" text REFERENCES "test_management_connections"("id") ON DELETE SET NULL,
  -- Kept as text too: the connection may be deleted, and the record must still read.
  "connection_name" text NOT NULL,
  "provider" text NOT NULL,
  -- 'published' | 'failed' | 'nothing_to_publish'.
  "status" text NOT NULL,
  -- The TestRail run id, the Xray Test Execution key, the Zephyr test cycle key.
  "external_key" text,
  "external_url" text,
  "published_count" integer DEFAULT 0 NOT NULL,
  -- Results of tests that have no case in the tool.
  "unmapped_count" integer DEFAULT 0 NOT NULL,
  "message" text,
  -- Who asked, for a publication done from the report; null for the one at the end of a run.
  "requested_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_management_publications_status_known" CHECK ("status" IN ('published', 'failed', 'nothing_to_publish'))
);
--> statement-breakpoint
CREATE INDEX "test_management_publications_execution_idx" ON "test_management_publications" ("test_plan_execution_id");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_management_connections', 'test_case_links', 'test_management_publications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_case_links_id_seq" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_management_publications_id_seq" TO app_user;
--> statement-breakpoint
-- The connection a plan publishes its runs to.
ALTER TABLE "test_plans" ADD COLUMN "test_management_id" text REFERENCES "test_management_connections"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Every link stays inside one organization, whoever writes it (see 0034).
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_test_management_id_same_org_fk" FOREIGN KEY ("test_management_id", "organization_id") REFERENCES "test_management_connections" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_case_links" ADD CONSTRAINT "test_case_links_connection_id_same_org_fk" FOREIGN KEY ("connection_id", "organization_id") REFERENCES "test_management_connections" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_case_links" ADD CONSTRAINT "test_case_links_test_id_same_org_fk" FOREIGN KEY ("test_id", "organization_id") REFERENCES "tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_case_links" ADD CONSTRAINT "test_case_links_api_test_id_same_org_fk" FOREIGN KEY ("api_test_id", "organization_id") REFERENCES "api_tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_management_publications" ADD CONSTRAINT "test_management_publications_test_plan_execution_id_same_org_fk" FOREIGN KEY ("test_plan_execution_id", "organization_id") REFERENCES "test_plan_executions" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_management_publications" ADD CONSTRAINT "test_management_publications_connection_id_same_org_fk" FOREIGN KEY ("connection_id", "organization_id") REFERENCES "test_management_connections" ("id", "organization_id");
