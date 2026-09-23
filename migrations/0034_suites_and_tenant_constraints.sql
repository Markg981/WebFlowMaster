-- 1. Suites: a named set of tests that plans share.
--
-- A plan chose its tests one by one. "Checkout", "Login" and "Search" sat in the nightly plan,
-- the release plan and the smoke plan, three separate lists; a new checkout test went into one of
-- them and was forgotten in the other two. A suite is the list, kept once:
--
--   static  — these tests, in this order.
--   dynamic — every test carrying all of these tags (optionally within one project), worked out
--             when a run is created, so a test tagged "checkout" tomorrow is in tomorrow's run.
--
-- A plan includes suites next to its own tests. When a run is created the suites are expanded
-- into tests and written into the run's snapshot like the rest, so a run is still exactly what
-- it ran, and the runner does not know suites exist.
CREATE TABLE "test_suites" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "description" text,
  "kind" text DEFAULT 'static' NOT NULL,
  -- The dynamic rule: tag ids, all of which a test must carry.
  "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_suites_kind_known" CHECK ("kind" IN ('static', 'dynamic')),
  CONSTRAINT "test_suites_id_organization_unique" UNIQUE ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "test_suites_organization_id_idx" ON "test_suites" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "test_suites_organization_name_unique" ON "test_suites" ("organization_id", lower("name"));
--> statement-breakpoint
CREATE TABLE "test_suite_items" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "suite_id" integer NOT NULL REFERENCES "test_suites"("id") ON DELETE CASCADE,
  "test_type" text NOT NULL,
  "test_id" integer REFERENCES "tests"("id") ON DELETE CASCADE,
  "api_test_id" integer REFERENCES "api_tests"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  CONSTRAINT "test_suite_items_one_test" CHECK (
    ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL)
    OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "test_suite_items_suite_id_idx" ON "test_suite_items" ("suite_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "test_suite_items_suite_ui_unique" ON "test_suite_items" ("suite_id", "test_id") WHERE "test_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "test_suite_items_suite_api_unique" ON "test_suite_items" ("suite_id", "api_test_id") WHERE "api_test_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "test_plan_suites" (
  "test_plan_id" text NOT NULL REFERENCES "test_plans"("id") ON DELETE CASCADE,
  "suite_id" integer NOT NULL REFERENCES "test_suites"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "position" integer NOT NULL,
  PRIMARY KEY ("test_plan_id", "suite_id")
);
--> statement-breakpoint
CREATE INDEX "test_plan_suites_suite_id_idx" ON "test_plan_suites" ("suite_id");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_suites', 'test_suite_items', 'test_plan_suites'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
  -- A suite in a restricted project is the project's, like its tests (migration 0031).
  CREATE POLICY project_read ON test_suites AS RESTRICTIVE FOR SELECT USING (app_project_visible(project_id));
  CREATE POLICY project_insert ON test_suites AS RESTRICTIVE FOR INSERT WITH CHECK (app_project_editable(project_id));
  CREATE POLICY project_update ON test_suites AS RESTRICTIVE FOR UPDATE USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id));
  CREATE POLICY project_delete ON test_suites AS RESTRICTIVE FOR DELETE USING (app_project_editable(project_id));
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_suites_id_seq" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_suite_items_id_seq" TO app_user;
--> statement-breakpoint

-- 2. Two rows that point at each other belong to the same organization — by the database's word.
--
-- Row-level security decides what a request can see; it says nothing about what a row may point
-- at. A plan's selected test, a result's test, a secret's environment each carry an
-- organization_id of their own, and until now only application code kept it equal to the
-- parent's: assertSelectedTestsBelongTo, the orchestrator's requester check, and the care of
-- whoever wrote each insert. Privileged code — the worker, a migration, a script — is outside
-- RLS entirely. One forgotten check there and a row of one organization points into another's.
--
-- Each link now has a second foreign key, (child column, organization_id) → (parent id,
-- organization_id), so such a row cannot exist, whoever writes it. The parents gain the
-- (id, organization_id) uniqueness this needs. The existing single-column keys stay: they carry
-- the ON DELETE behaviour, and these (NO ACTION, checked at the end of the statement) only check
-- the organization. A null link is not checked (MATCH SIMPLE), so ON DELETE SET NULL still works.
--
-- Added NOT VALID, so new writes are held to them at once, and then validated. An installation
-- whose history already holds a mismatched row gets a warning naming the constraint instead of a
-- failed upgrade: the constraint still refuses new mismatches, and the old row can be looked at.
DO $$
DECLARE
  parent text;
  link text[];
  constraint_name text;
BEGIN
  FOREACH parent IN ARRAY ARRAY[
    'users', 'projects', 'tests', 'api_tests', 'test_plans', 'test_plan_schedules',
    'test_plan_executions', 'environments', 'tags', 'issue_trackers'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (id, organization_id)', parent, parent || '_id_organization_unique');
  END LOOP;

  FOREACH link SLICE 1 IN ARRAY ARRAY[
    ['project_members', 'project_id', 'projects'],
    ['project_members', 'user_id', 'users'],
    ['tests', 'project_id', 'projects'],
    ['test_runs', 'test_id', 'tests'],
    ['detected_elements', 'test_id', 'tests'],
    ['api_tests', 'project_id', 'projects'],
    ['test_plans', 'issue_tracker_id', 'issue_trackers'],
    ['test_plan_schedules', 'test_plan_id', 'test_plans'],
    ['test_plan_executions', 'test_plan_id', 'test_plans'],
    ['test_plan_executions', 'schedule_id', 'test_plan_schedules'],
    ['test_plan_executions', 'requested_by_user_id', 'users'],
    ['test_plan_executions', 'retry_of_execution_id', 'test_plan_executions'],
    ['execution_logs', 'test_plan_execution_id', 'test_plan_executions'],
    ['excel_sequences_map', 'test_id', 'tests'],
    ['report_test_case_results', 'test_plan_execution_id', 'test_plan_executions'],
    ['report_test_case_results', 'ui_test_id', 'tests'],
    ['report_test_case_results', 'api_test_id', 'api_tests'],
    ['secrets', 'environment_id', 'environments'],
    ['test_plan_webhooks', 'test_plan_id', 'test_plans'],
    ['test_plan_selected_tests', 'test_plan_id', 'test_plans'],
    ['test_plan_selected_tests', 'test_id', 'tests'],
    ['test_plan_selected_tests', 'api_test_id', 'api_tests'],
    ['step_groups', 'project_id', 'projects'],
    ['project_elements', 'project_id', 'projects'],
    ['test_tags', 'tag_id', 'tags'],
    ['test_tags', 'test_id', 'tests'],
    ['test_tags', 'api_test_id', 'api_tests'],
    ['test_versions', 'test_id', 'tests'],
    ['test_publications', 'test_id', 'tests'],
    ['test_reviews', 'test_id', 'tests'],
    ['issue_links', 'tracker_id', 'issue_trackers'],
    ['issue_links', 'test_plan_id', 'test_plans'],
    ['issue_links', 'ui_test_id', 'tests'],
    ['issue_links', 'first_execution_id', 'test_plan_executions'],
    ['issue_links', 'last_execution_id', 'test_plan_executions'],
    ['api_keys', 'user_id', 'users'],
    ['test_suites', 'project_id', 'projects'],
    ['test_suite_items', 'suite_id', 'test_suites'],
    ['test_suite_items', 'test_id', 'tests'],
    ['test_suite_items', 'api_test_id', 'api_tests'],
    ['test_plan_suites', 'test_plan_id', 'test_plans'],
    ['test_plan_suites', 'suite_id', 'test_suites']
  ] LOOP
    constraint_name := link[1] || '_' || link[2] || '_same_org_fk';
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, organization_id) REFERENCES %I (id, organization_id) NOT VALID',
      link[1], constraint_name, link[2], link[3]
    );
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', link[1], constraint_name);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'Existing rows of % point at % in another organization; % is enforced for new rows but not yet validated.',
        link[1], link[3], constraint_name;
    END;
  END LOOP;
END $$;
