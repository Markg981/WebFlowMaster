-- Importing whole hub modules as a background job (QA hub catalog, Test Manager).
-- A third job kind beside the waves sync and the wave import.
ALTER TABLE hub_jobs DROP CONSTRAINT hub_jobs_kind_known;
--> statement-breakpoint
ALTER TABLE hub_jobs ADD CONSTRAINT hub_jobs_kind_known
  CHECK ("kind" IN ('waves_sync', 'wave_import', 'modules_import'));
