-- The runner now applies a plan's timeouts, and two of the stored ones are in the wrong unit.
--
-- The plan wizard asks for seconds and sent what it was given — 30 — into columns that every
-- other writer, and the column default, fill in milliseconds. Nothing read them, so nothing
-- noticed; applied as they are, those plans would time out every step after 30 milliseconds.
-- A timeout under one second is that mistake, never a choice, so those are read as seconds.
UPDATE "test_plans" SET "page_load_timeout" = "page_load_timeout" * 1000
  WHERE "page_load_timeout" > 0 AND "page_load_timeout" < 1000;
--> statement-breakpoint
UPDATE "test_plans" SET "element_timeout" = "element_timeout" * 1000
  WHERE "element_timeout" > 0 AND "element_timeout" < 1000;
--> statement-breakpoint
-- How many times a test ran in its run before its result stood — see "Re-Run On Failure".
ALTER TABLE "report_test_case_results"
  ADD COLUMN "attempts" integer NOT NULL DEFAULT 1;
