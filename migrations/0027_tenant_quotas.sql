-- How much of the execution plane one organization may hold at once.
--
-- Runs were taken first come, first served, and nothing bounded one organization: a pipeline
-- that queued fifty runs held every worker until the fiftieth was done, and every other tenant
-- waited behind it. Two limits now, with installation-wide defaults (ORG_MAX_CONCURRENT_RUNS,
-- ORG_MAX_QUEUED_RUNS) and these columns to change them for one organization:
--
--   max_concurrent_runs — runs of the organization executing at the same time. A run past it
--                         waits in the queue, it does not fail.
--   max_queued_runs     — runs waiting at once. Asking for one more is refused (429).
--
-- Null means the default. There is no grant to change them: an organization cannot raise its
-- own limits; the operator of the installation sets them.
ALTER TABLE "organizations"
  ADD COLUMN "max_concurrent_runs" integer,
  ADD COLUMN "max_queued_runs" integer;
--> statement-breakpoint
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_max_concurrent_runs_positive" CHECK ("max_concurrent_runs" IS NULL OR "max_concurrent_runs" > 0),
  ADD CONSTRAINT "organizations_max_queued_runs_positive" CHECK ("max_queued_runs" IS NULL OR "max_queued_runs" > 0);
