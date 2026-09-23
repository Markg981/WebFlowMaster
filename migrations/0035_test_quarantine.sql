-- Quarantine: a test set aside while it is unreliable.
--
-- The flaky analysis (server/flaky.ts) says which tests change their verdict with nothing to
-- explain it. Knowing did not help the pipeline: the same test still failed the nightly run one
-- night in three, the build went red, somebody re-ran it until it went green, and the team learnt
-- that a red build means "try again" — which is how the real failure gets through.
--
-- A quarantined test keeps running and its result is recorded, so everyone can see whether the fix
-- worked. But its failure does not fail the run, stop the plan, file an issue or fail a pipeline.
-- Quarantine is set by a person, with a reason, and taken off by a person. It lasts until somebody
-- releases it, and each row keeps the history of one period in quarantine.
CREATE TABLE "test_quarantines" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "test_type" text NOT NULL,
  "test_id" integer REFERENCES "tests"("id") ON DELETE CASCADE,
  "api_test_id" integer REFERENCES "api_tests"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "quarantined_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "quarantined_at" timestamp DEFAULT now() NOT NULL,
  "released_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "released_at" timestamp,
  "release_note" text,
  CONSTRAINT "test_quarantines_one_test" CHECK (
    ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL)
    OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL)
  ),
  CONSTRAINT "test_quarantines_reason_given" CHECK (length(trim("reason")) > 0),
  -- The same organization as the test, whoever writes the row (see migration 0034).
  CONSTRAINT "test_quarantines_test_id_same_org_fk" FOREIGN KEY ("test_id", "organization_id") REFERENCES "tests" ("id", "organization_id"),
  CONSTRAINT "test_quarantines_api_test_id_same_org_fk" FOREIGN KEY ("api_test_id", "organization_id") REFERENCES "api_tests" ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "test_quarantines_organization_id_idx" ON "test_quarantines" ("organization_id");
--> statement-breakpoint
-- At most one open quarantine per test.
CREATE UNIQUE INDEX "test_quarantines_open_ui_unique" ON "test_quarantines" ("test_id") WHERE "released_at" IS NULL AND "test_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "test_quarantines_open_api_unique" ON "test_quarantines" ("api_test_id") WHERE "released_at" IS NULL AND "api_test_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_quarantines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "test_quarantines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "test_quarantines"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- A test in a restricted project is quarantined and released by those who can edit it, and seen by
-- those who can see it (migration 0031). A quarantine has no project of its own: it is its test's.
-- Both functions run as the caller, so the test is looked up through the test's own policies — a
-- test the caller cannot see is not found, and its quarantine is neither seen nor changed.
CREATE FUNCTION app_quarantine_visible(p_test_id integer, p_api_test_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM tests WHERE id = p_test_id)
        OR EXISTS (SELECT 1 FROM api_tests WHERE id = p_api_test_id)
$$;
--> statement-breakpoint
CREATE FUNCTION app_quarantine_editable(p_test_id integer, p_api_test_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT app_quarantine_visible(p_test_id, p_api_test_id)
       AND app_project_editable(COALESCE(
             (SELECT project_id FROM tests WHERE id = p_test_id),
             (SELECT project_id FROM api_tests WHERE id = p_api_test_id)))
$$;
--> statement-breakpoint
CREATE POLICY project_read ON "test_quarantines" AS RESTRICTIVE FOR SELECT
  USING (app_quarantine_visible(test_id, api_test_id));
--> statement-breakpoint
CREATE POLICY project_insert ON "test_quarantines" AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_quarantine_editable(test_id, api_test_id));
--> statement-breakpoint
CREATE POLICY project_update ON "test_quarantines" AS RESTRICTIVE FOR UPDATE
  USING (app_quarantine_editable(test_id, api_test_id))
  WITH CHECK (app_quarantine_editable(test_id, api_test_id));
--> statement-breakpoint
-- No DELETE: releasing closes the row, and the history stays.
GRANT SELECT, INSERT, UPDATE ON TABLE "test_quarantines" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_quarantines_id_seq" TO app_user;
--> statement-breakpoint
-- Each result says whether its test was in quarantine when it ran, and each run how many of its
-- failures were. The run's failed count still includes them: they did fail.
ALTER TABLE "report_test_case_results" ADD COLUMN "quarantined" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ADD COLUMN "quarantined_failures" integer DEFAULT 0 NOT NULL;
