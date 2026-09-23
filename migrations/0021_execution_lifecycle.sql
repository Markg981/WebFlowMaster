-- One lifecycle for a run, with the database enforcing which way it can move.
--
-- A run's status was a string any code path could overwrite. The worker set 'running' without
-- asking what the row said; the final update set 'completed' the same way. So a job BullMQ
-- delivered twice ran the whole plan twice, and a late write from a worker that had been given
-- up on could turn a finished run back into a running one. Nothing was wrong with any single
-- write — the trouble was that none of them looked at what came before.
--
-- 'pending' becomes 'queued'. The old word meant two things: "waiting for a worker" and "a
-- test row nobody has reached yet" on the execution page. Only the first is a state of the run,
-- and it gets a name of its own.
--
-- started_at loses its default and becomes nullable. It used to be stamped at enqueue time, so
-- a run that sat in the queue for ten minutes reported ten minutes it never ran for. queued_at
-- is when somebody asked; started_at is when a worker began.
ALTER TABLE "test_plan_executions"
  -- Who asked for this run. Null for rows from before this was recorded, and SET NULL when the
  -- member leaves: the run happened whether or not the person is still here.
  ADD COLUMN "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "queued_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN "cancel_requested_at" timestamp,
  -- Stamped when a worker takes the run, so "running since when, and is anyone still there?"
  -- has an answer.
  ADD COLUMN "heartbeat_at" timestamp,
  -- Why a run ended in 'error', in a form code can branch on and a person can read.
  ADD COLUMN "failure_code" text,
  ADD COLUMN "failure_message" text;
--> statement-breakpoint
-- Rows that existed before get the moment they were asked for, which was the only time that
-- was ever recorded for them.
UPDATE "test_plan_executions" SET "queued_at" = "started_at" WHERE "started_at" IS NOT NULL;
--> statement-breakpoint
UPDATE "test_plan_executions" SET "status" = 'queued' WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ALTER COLUMN "status" SET DEFAULT 'queued';
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ALTER COLUMN "started_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_executions" ALTER COLUMN "started_at" DROP DEFAULT;
