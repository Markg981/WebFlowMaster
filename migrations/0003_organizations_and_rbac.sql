-- 1. Structure, all nullable for now.
CREATE TABLE "organizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'editor' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "detected_elements" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "api_tests" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "api_test_history" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "test_plans" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "test_plan_schedules" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "test_plan_webhooks" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "execution_logs" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "excel_sequences_map" ADD COLUMN "organization_id" integer;
--> statement-breakpoint

-- 2. One organization per existing user; that user becomes its owner.
INSERT INTO "organizations" ("name")
SELECT username || '''s organization' FROM "users" ORDER BY id;
--> statement-breakpoint

UPDATE "users" u
SET "organization_id" = o.id, "role" = 'owner'
FROM (
  SELECT u2.id AS user_id, o2.id AS id
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM "users") u2
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM "organizations") o2
    ON u2.rn = o2.rn
) o
WHERE u.id = o.user_id;
--> statement-breakpoint

-- 3. Backfill every org-scoped table from its existing user ownership.
UPDATE "projects" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint
UPDATE "tests" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint
UPDATE "api_tests" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint
UPDATE "api_test_history" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint
UPDATE "test_plans" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint
UPDATE "environments" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint
UPDATE "secrets" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
--> statement-breakpoint

-- Tables without their own user_id inherit through their parent.
UPDATE "test_runs" t SET "organization_id" = p."organization_id" FROM "tests" p WHERE t."test_id" = p.id;
--> statement-breakpoint
UPDATE "detected_elements" t SET "organization_id" = p."organization_id" FROM "tests" p WHERE t."test_id" = p.id;
--> statement-breakpoint
UPDATE "test_plan_schedules" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
--> statement-breakpoint
UPDATE "test_plan_executions" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
--> statement-breakpoint
UPDATE "test_plan_selected_tests" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
--> statement-breakpoint
UPDATE "test_plan_webhooks" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
--> statement-breakpoint
UPDATE "execution_logs" t SET "organization_id" = e."organization_id" FROM "test_plan_executions" e WHERE t."test_plan_execution_id" = e.id;
--> statement-breakpoint
UPDATE "report_test_case_results" t SET "organization_id" = e."organization_id" FROM "test_plan_executions" e WHERE t."test_plan_execution_id" = e.id;
--> statement-breakpoint
UPDATE "excel_sequences_map" t SET "organization_id" = p."organization_id" FROM "tests" p WHERE t."test_id" = p.id;
--> statement-breakpoint

-- 4. Refuse to continue if anything is unassigned. An orphan row would survive this
--    migration silently and then become invisible to everyone once RLS activates —
--    not lost, but unfindable, with nothing reporting it.
DO $$
DECLARE
  t text;
  orphans bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','projects','tests','test_runs','detected_elements','api_tests','api_test_history',
    'test_plans','test_plan_schedules','test_plan_executions','test_plan_selected_tests',
    'test_plan_webhooks','report_test_case_results','execution_logs','environments','secrets',
    'excel_sequences_map'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE organization_id IS NULL', t) INTO orphans;
    IF orphans > 0 THEN
      RAISE EXCEPTION 'Migration aborted: % row(s) in % have no organization_id', orphans, t;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- 5. Now, and only now, enforce.
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tests" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_runs" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "detected_elements" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_tests" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_test_history" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plans" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_schedules" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_webhooks" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_logs" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "environments" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "secrets" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "excel_sequences_map" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint

CREATE INDEX "users_organization_id_idx" ON "users" ("organization_id");
--> statement-breakpoint
CREATE INDEX "projects_organization_id_idx" ON "projects" ("organization_id");
--> statement-breakpoint
CREATE INDEX "tests_organization_id_idx" ON "tests" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_runs_organization_id_idx" ON "test_runs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "detected_elements_organization_id_idx" ON "detected_elements" ("organization_id");
--> statement-breakpoint
CREATE INDEX "api_tests_organization_id_idx" ON "api_tests" ("organization_id");
--> statement-breakpoint
CREATE INDEX "api_test_history_organization_id_idx" ON "api_test_history" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_plans_organization_id_idx" ON "test_plans" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_plan_schedules_organization_id_idx" ON "test_plan_schedules" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_plan_executions_organization_id_idx" ON "test_plan_executions" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_plan_selected_tests_organization_id_idx" ON "test_plan_selected_tests" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_plan_webhooks_organization_id_idx" ON "test_plan_webhooks" ("organization_id");
--> statement-breakpoint
CREATE INDEX "report_test_case_results_organization_id_idx" ON "report_test_case_results" ("organization_id");
--> statement-breakpoint
CREATE INDEX "execution_logs_organization_id_idx" ON "execution_logs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "environments_organization_id_idx" ON "environments" ("organization_id");
--> statement-breakpoint
CREATE INDEX "secrets_organization_id_idx" ON "secrets" ("organization_id");
--> statement-breakpoint
CREATE INDEX "excel_sequences_map_organization_id_idx" ON "excel_sequences_map" ("organization_id");
--> statement-breakpoint

-- 6. The application role. NOLOGIN because the app reaches it via SET LOCAL ROLE, not by
--    connecting as it — the connection string is deliberately left unchanged.
CREATE ROLE app_user NOLOGIN;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
