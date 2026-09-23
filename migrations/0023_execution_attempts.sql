-- A schedule's "retry on failure", counted on the runs themselves.
--
-- The scheduler used to retry by calling the enqueue again whenever its answer said "failed". The
-- answer to an enqueue is never a verdict — it is "queued" — so the retry never happened, and the
-- setting a user chose did nothing. A retry is now a run of its own, queued by the worker when an
-- attempt ends failed and attempts remain: each attempt keeps its own report, and the second one
-- runs with exactly the configuration of the first.
--
-- attempt / max_attempts: which attempt this run is, out of how many the request allowed. 1 of 1
-- for every existing row and every run that is not a scheduled one with a retry policy.
-- retry_of_execution_id: the first attempt, on every later one, so the attempts of one scheduled
-- occurrence can be read together.
ALTER TABLE "test_plan_executions"
  ADD COLUMN "attempt" integer NOT NULL DEFAULT 1,
  ADD COLUMN "max_attempts" integer NOT NULL DEFAULT 1,
  ADD COLUMN "retry_of_execution_id" text REFERENCES "test_plan_executions"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_executions"
  ADD CONSTRAINT "test_plan_executions_attempt_range" CHECK ("attempt" >= 1 AND "attempt" <= "max_attempts");
--> statement-breakpoint
CREATE INDEX "test_plan_executions_retry_of_idx" ON "test_plan_executions" ("retry_of_execution_id");
