-- A plan run on several workers at once (server/run-shards.ts). `shards` is how many workers may
-- share one run; 1, the default, is how every plan has run until now.
ALTER TABLE "test_plans" ADD COLUMN IF NOT EXISTS "shards" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_shards_range" CHECK ("shards" BETWEEN 1 AND 8);
--> statement-breakpoint
-- The work of a sharded run: one item per test of a browser and language (per browser and
-- language when the plan's API tests pass values on, which keeps them in order). Whoever takes the
-- run writes them; every worker sharing it claims them one at a time. A claim whose heartbeat stops
-- is taken back. `unit` is what to run, as the run's first worker resolved it; `results` holds what
-- the item produced for the run's summary.
CREATE TABLE "run_work_items" (
  "execution_id" text NOT NULL REFERENCES "test_plan_executions"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "key" text NOT NULL,
  "position" integer NOT NULL,
  "unit" jsonb NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "claimed_by" text,
  "heartbeat_at" timestamp,
  "finished_at" timestamp,
  "error" text,
  "results" jsonb,
  CONSTRAINT "run_work_items_pkey" PRIMARY KEY ("execution_id", "key"),
  CONSTRAINT "run_work_items_state_check" CHECK ("state" IN ('pending', 'claimed', 'done'))
);
--> statement-breakpoint
CREATE INDEX "run_work_items_organization_id_idx" ON "run_work_items" ("organization_id");
--> statement-breakpoint
-- An item is of a run of its own organization (migration 0034).
ALTER TABLE "run_work_items" ADD CONSTRAINT "run_work_items_execution_id_same_org_fk"
  FOREIGN KEY ("execution_id", "organization_id") REFERENCES "test_plan_executions"("id", "organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "run_work_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_work_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "run_work_items"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "run_work_items" TO app_user;
--> statement-breakpoint
-- The reason a sharded run stops early (a plan's stop policy), seen by every worker sharing it.
ALTER TABLE "test_plan_executions" ADD COLUMN IF NOT EXISTS "stop_reason" text;
