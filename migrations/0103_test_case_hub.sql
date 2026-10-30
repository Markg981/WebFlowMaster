-- The QA test case hub (shared/testcases-hub.ts, server/integrations/testcases-hub.ts).
--
-- test_case_sources: where an organization reads its test case definitions from — a folder the
-- server can see, under an operator-allowed root (TESTCASE_HUB_ROOTS), or an Azure DevOps git
-- repository read through its REST API. One per organization. The token is encrypted as an
-- issue tracker's and never returned.
--
-- hub_test_cases: the catalog, one row per case as the hub held it at the last refresh, and the
-- library test each imported case became. imported_hash is the content the test was made from,
-- so a later refresh can say "changed in the hub since you imported it" without touching the
-- test. A case that leaves the hub keeps its row, with missing_since set.
CREATE TABLE "test_case_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "path" text,
  "base_url" text,
  "project" text,
  "repository" text,
  "branch" text,
  "encrypted_token" text,
  "token_iv" text,
  "token_auth_tag" text,
  "last_refresh_at" timestamp,
  "last_refresh_head" text,
  "last_refresh_status" text,
  "last_refresh_error" text,
  "case_count" integer DEFAULT 0 NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_case_sources_kind_known" CHECK ("kind" IN ('folder', 'azure-devops')),
  CONSTRAINT "test_case_sources_refresh_status_known"
    CHECK ("last_refresh_status" IS NULL OR "last_refresh_status" IN ('ok', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_sources_organization_id_unique" ON "test_case_sources" ("organization_id");
--> statement-breakpoint
CREATE TABLE "hub_test_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "source_id" text NOT NULL REFERENCES "test_case_sources"("id") ON DELETE CASCADE,
  "case_id" text NOT NULL,
  "raw_id" text NOT NULL,
  "module" text NOT NULL,
  "execution_module" text,
  "status" text NOT NULL,
  "priority" text,
  "readiness_level" integer DEFAULT 0 NOT NULL,
  "version_from" text,
  "version_to" text,
  "devops_id" text,
  "sme" text,
  "feature_highlight" text,
  "execution_group" text,
  "functional_objective" text DEFAULT '' NOT NULL,
  "precondition" text DEFAULT '' NOT NULL,
  "steps" text DEFAULT '' NOT NULL,
  "expected_outcome" text DEFAULT '' NOT NULL,
  "ref_env_precondition" text DEFAULT '' NOT NULL,
  "ref_env_steps" text DEFAULT '' NOT NULL,
  "ref_env_expected_outcome" text DEFAULT '' NOT NULL,
  "depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "force_not_tested" boolean DEFAULT false NOT NULL,
  "source_updated_at" timestamp,
  "content_hash" text NOT NULL,
  "refreshed_at" timestamp DEFAULT now() NOT NULL,
  "missing_since" timestamp,
  "test_id" integer REFERENCES "tests"("id") ON DELETE SET NULL,
  "imported_hash" text,
  "imported_at" timestamp,
  "imported_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "hub_test_cases_readiness_range" CHECK ("readiness_level" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX "hub_test_cases_organization_id_idx" ON "hub_test_cases" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hub_test_cases_source_case_unique" ON "hub_test_cases" ("source_id", "case_id");
--> statement-breakpoint
CREATE INDEX "hub_test_cases_module_idx" ON "hub_test_cases" ("organization_id", "module");
--> statement-breakpoint
CREATE INDEX "hub_test_cases_test_id_idx" ON "hub_test_cases" ("test_id");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_case_sources', 'hub_test_cases'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "hub_test_cases_id_seq" TO app_user;
