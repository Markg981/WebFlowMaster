-- The build, commit and branch a pipeline started a run for (shared/ci.ts).
--
-- A run started from CI said only "triggered by api": nothing on the report led back to the commit
-- it tested or the build that asked for it. The CLI now sends that with the run, read from the CI
-- system's own environment, and it is kept here. Null for every other run.
ALTER TABLE "test_plan_executions" ADD COLUMN "ci_context" jsonb;
