-- What a run was asked to do, written down when it was asked.
--
-- A queued run carried only the plan's id, and the worker read the plan when it got round to it.
-- So a plan edited while a run waited in the queue ran with settings nobody had chosen for that
-- run — another browser, another set of tests, notifications going somewhere new — and the
-- report of it described a configuration that was never the one requested. On a quiet system
-- that window is a second; behind a busy queue or a nightly schedule it is as long as the queue.
--
-- configuration_snapshot holds every setting the run will use, taken from the plan (and from
-- whatever the request overrode) at enqueue time. The worker runs from it. '{}' is what every
-- row written before this holds, and the worker reads the plan for those, exactly as it did.
ALTER TABLE "test_plan_executions"
  ADD COLUMN "configuration_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Chosen by whoever asks for the run, so that asking twice — a retried HTTP request, a
  -- pipeline step that ran again — gets the same run back instead of a second one.
  ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
-- Per organization: two tenants choosing the same key is ordinary and says nothing about either.
-- Partial, because a run with no key is not claiming to be the same as any other run.
CREATE UNIQUE INDEX "test_plan_executions_org_idempotency_unique"
  ON "test_plan_executions" ("organization_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
