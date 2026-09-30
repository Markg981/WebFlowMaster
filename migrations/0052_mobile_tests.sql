-- Tests of native mobile apps (shared/mobile.ts): an Android or iOS app on a real device of a
-- cloud grid (BrowserStack or LambdaTest App Automate), driven through Appium.
--
-- A test of its own kind beside web and API tests: its steps name native elements (accessibility
-- ids, resource ids, XPath of the app's view tree), not CSS selectors, and it runs on a device, not
-- in a browser. The app itself is on the grid (bs://… or lt://…), uploaded through it.
CREATE TABLE "mobile_tests" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  -- 'android' | 'ios'.
  "platform" text NOT NULL,
  -- The app on the grid: bs://…, lt://…, or an address the grid downloads it from.
  "app" text NOT NULL,
  -- As the grid names it: "Google Pixel 8", "iPhone 15".
  "device_name" text NOT NULL,
  "os_version" text,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mobile_tests_platform_known" CHECK ("platform" IN ('android', 'ios')),
  CONSTRAINT "mobile_tests_id_organization_unique" UNIQUE ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "mobile_tests_organization_id_idx" ON "mobile_tests" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_tests_organization_name_unique" ON "mobile_tests" ("organization_id", lower("name"));
--> statement-breakpoint
-- One run of a mobile test on a grid's device, and what each step did.
CREATE TABLE "mobile_test_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "mobile_test_id" integer NOT NULL REFERENCES "mobile_tests"("id") ON DELETE CASCADE,
  "grid_id" text REFERENCES "browser_grids"("id") ON DELETE SET NULL,
  "environment_id" integer REFERENCES "environments"("id") ON DELETE SET NULL,
  -- 'queued' | 'running' | 'passed' | 'failed' | 'error'.
  "status" text NOT NULL,
  -- The device and OS as asked for, kept as text: the test may change afterwards.
  "device" text NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error" text,
  -- The screenshot of the device when the run ended, PNG as base64.
  "screenshot" text,
  -- The grid's page for the session, with its video and logs, when the grid gives one.
  "session_url" text,
  "requested_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mobile_test_runs_status_known" CHECK ("status" IN ('queued', 'running', 'passed', 'failed', 'error'))
);
--> statement-breakpoint
CREATE INDEX "mobile_test_runs_test_idx" ON "mobile_test_runs" ("mobile_test_id", "created_at");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mobile_tests', 'mobile_test_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "mobile_tests_id_seq" TO app_user;
--> statement-breakpoint
-- Every link stays inside one organization, whoever writes it (see 0034).
ALTER TABLE "mobile_tests" ADD CONSTRAINT "mobile_tests_project_id_same_org_fk" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "mobile_test_runs" ADD CONSTRAINT "mobile_test_runs_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "mobile_test_runs" ADD CONSTRAINT "mobile_test_runs_grid_id_same_org_fk" FOREIGN KEY ("grid_id", "organization_id") REFERENCES "browser_grids" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "mobile_test_runs" ADD CONSTRAINT "mobile_test_runs_environment_id_same_org_fk" FOREIGN KEY ("environment_id", "organization_id") REFERENCES "environments" ("id", "organization_id");
