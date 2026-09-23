-- Which version of the test produced this result.
--
-- The history of a test exists (migration 0018) and the runs exist, and nothing connected the
-- two. So the first question asked of every failure — did the application change, or did the
-- test? — still had no answer from the data: somebody had to open the history, read the dates,
-- and match them against the run by eye.
--
-- It matters most where the suite already makes a claim about a test's behaviour over time. A
-- test that passed on Monday and failed on Tuesday is called flaky by the flaky analysis, which
-- counts changes of verdict between consecutive runs. If the test was edited on Monday night,
-- that change of verdict is explained, and counting it as flakiness teaches people to distrust
-- a measure that is telling them the truth the rest of the time.
--
-- Nullable, and null for every row written before now: a result that does not know which
-- version it ran is exactly what those are, and a default of 1 would be a claim nobody made.
-- The analysis reads two nulls as "the same unknown version", so historical data keeps counting
-- the way it always did — an unrecorded version cannot explain anything.
ALTER TABLE "report_test_case_results" ADD COLUMN "test_version" integer;
--> statement-breakpoint
CREATE INDEX "report_test_case_results_test_version_idx" ON "report_test_case_results" ("ui_test_id", "test_version");
