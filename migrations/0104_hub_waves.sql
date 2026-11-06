-- QA hub waves: the results history of the QA team's test sessions (shared/hub-waves.ts,
-- server/integrations/hub-waves.ts).
--
-- hub_waves: one row per Waves/<wave_id>/wave.json of the organization's hub source, as the last
-- sync read it. file_hashes holds the content hash of every file the row was read from, so the
-- next sync skips a wave whose files did not change. test_plan_id / execution_id are what the
-- wave became in WFM when it was imported (one plan and one execution per wave,
-- triggered_by 'hub-import'); materialized_hash is the content it was imported from.
--
-- hub_wave_results: one row per case of a wave, the wave's entry (module, tester, stage) and the
-- result the QA team recorded (raw hub status, build, bug, notes, every attempt). Kept as the hub
-- has it: the WFM status is worked out on import.
--
-- hub_jobs: the long work (a waves sync, a wave import) run after the response, with its progress
-- and outcome. At most one job queued or running per source.
CREATE TABLE "hub_waves" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "source_id" text NOT NULL REFERENCES "test_case_sources"("id") ON DELETE CASCADE,
  "wave_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "release" text,
  "major_release" text,
  "wave_type" text,
  "status" text,
  "start_date" text,
  "target_date" text,
  "modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "workbook_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_name" text,
  "source_created_at" timestamp,
  "source_updated_at" timestamp,
  "entry_count" integer DEFAULT 0 NOT NULL,
  "content_hash" text NOT NULL,
  "file_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "synced_at" timestamp DEFAULT now() NOT NULL,
  "missing_since" timestamp,
  "test_plan_id" text REFERENCES "test_plans"("id") ON DELETE SET NULL,
  "execution_id" text REFERENCES "test_plan_executions"("id") ON DELETE SET NULL,
  "materialized_hash" text,
  "materialized_at" timestamp,
  "materialized_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "hub_waves_id_organization_unique" UNIQUE ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "hub_waves_organization_id_idx" ON "hub_waves" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hub_waves_source_wave_unique" ON "hub_waves" ("source_id", "wave_id");
--> statement-breakpoint
CREATE INDEX "hub_waves_execution_id_idx" ON "hub_waves" ("execution_id");
--> statement-breakpoint
CREATE INDEX "hub_waves_test_plan_id_idx" ON "hub_waves" ("test_plan_id");
--> statement-breakpoint
CREATE TABLE "hub_wave_results" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "wave_row_id" integer NOT NULL REFERENCES "hub_waves"("id") ON DELETE CASCADE,
  "case_id" text NOT NULL,
  "raw_case_id" text NOT NULL,
  "module" text,
  "definition_module" text,
  "assigned_tester" text,
  "stage" text,
  "stage_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text NOT NULL,
  "executed_by" text,
  "execution_date" text,
  "build_number" text,
  "bug_reference" text,
  "bug_priority" text,
  "notes" text,
  "attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hub_wave_results_organization_id_idx" ON "hub_wave_results" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hub_wave_results_wave_case_unique" ON "hub_wave_results" ("wave_row_id", "case_id");
--> statement-breakpoint
CREATE INDEX "hub_wave_results_case_idx" ON "hub_wave_results" ("organization_id", "case_id");
--> statement-breakpoint
CREATE TABLE "hub_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "source_id" text NOT NULL REFERENCES "test_case_sources"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "summary" jsonb,
  "error" text,
  "requested_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "finished_at" timestamp,
  "heartbeat_at" timestamp,
  "cancel_requested_at" timestamp,
  CONSTRAINT "hub_jobs_kind_known" CHECK ("kind" IN ('waves_sync', 'wave_import')),
  CONSTRAINT "hub_jobs_status_known"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "hub_jobs_organization_id_idx" ON "hub_jobs" ("organization_id");
--> statement-breakpoint
CREATE INDEX "hub_jobs_source_created_idx" ON "hub_jobs" ("source_id", "created_at");
--> statement-breakpoint
-- One piece of long work at a time per source: two imports of the same wave would race.
CREATE UNIQUE INDEX "hub_jobs_one_live_per_source" ON "hub_jobs" ("source_id") WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
-- Every link stays inside one organization, whoever writes it (see 0034).
ALTER TABLE "hub_waves" ADD CONSTRAINT "hub_waves_source_id_same_org_fk" FOREIGN KEY ("source_id", "organization_id") REFERENCES "test_case_sources" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "hub_waves" ADD CONSTRAINT "hub_waves_test_plan_id_same_org_fk" FOREIGN KEY ("test_plan_id", "organization_id") REFERENCES "test_plans" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "hub_waves" ADD CONSTRAINT "hub_waves_execution_id_same_org_fk" FOREIGN KEY ("execution_id", "organization_id") REFERENCES "test_plan_executions" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "hub_wave_results" ADD CONSTRAINT "hub_wave_results_wave_row_id_same_org_fk" FOREIGN KEY ("wave_row_id", "organization_id") REFERENCES "hub_waves" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "hub_jobs" ADD CONSTRAINT "hub_jobs_source_id_same_org_fk" FOREIGN KEY ("source_id", "organization_id") REFERENCES "test_case_sources" ("id", "organization_id");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hub_waves', 'hub_wave_results', 'hub_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "hub_waves_id_seq" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "hub_wave_results_id_seq" TO app_user;
