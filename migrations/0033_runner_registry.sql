-- The machines that run plans, and which one ran each run.
--
-- A worker was invisible until it failed. Nobody could tell how many were running, which
-- version they were on, whether one had no Firefox, or — when every run sat "queued" — that
-- none was running at all. And there was no way to take one out of service for an upgrade
-- without killing whatever it was in the middle of.
--
--   runners        — one row per worker process, written by the worker itself: where it runs,
--                    what version, how many runs at once, which browsers it has, when it last
--                    reported in. A row not heard from for a while is offline; one gone for a
--                    week is removed.
--   desired_state  — 'drain' asks a runner to finish what it is doing and take nothing new;
--                    'active' puts it back. The worker reads it on every heartbeat.
--   test_plan_executions.runner_id
--                  — which runner took the run. Readable on its own (host:pid:suffix), so it
--                    still says where a run went after the runner row is gone.
--
-- Installation-wide, like system_settings: a runner serves every organization. No RLS and no
-- grant to app_user: only server/runner-registry.ts touches it, on the privileged handle, and
-- what it shows an owner is about machines, never about another organization's runs.
CREATE TABLE "runners" (
  "id" text PRIMARY KEY,
  "hostname" text NOT NULL,
  "pid" integer NOT NULL,
  "version" text,
  "concurrency" integer NOT NULL,
  "browser_task_concurrency" integer NOT NULL,
  "browsers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active_jobs" integer DEFAULT 0 NOT NULL,
  "desired_state" text DEFAULT 'active' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "stopped_at" timestamp,
  CONSTRAINT "runners_desired_state_known" CHECK ("desired_state" IN ('active', 'drain'))
);
--> statement-breakpoint
CREATE INDEX "runners_last_seen_at_idx" ON "runners" ("last_seen_at");
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ADD COLUMN "runner_id" text;
