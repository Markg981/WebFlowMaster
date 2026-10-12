-- Load runs (shared/load-test.ts) are executed by the workers, as BullMQ jobs on the load queue
-- (server/queue.ts, loadQueue), instead of inside the web process: a run no longer dies with a
-- web restart. A run is `queued` until a worker takes it and `running` from then on; a running
-- run whose worker stops answering ends as `worker_lost`, like a plan run.
ALTER TABLE load_test_runs DROP CONSTRAINT load_test_runs_status_check;
--> statement-breakpoint
ALTER TABLE load_test_runs ADD CONSTRAINT load_test_runs_status_check CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled', 'error', 'worker_lost'));
--> statement-breakpoint
-- The job that executes it, the worker that took it, and when it was asked for (started_at is
-- when the worker took it).
ALTER TABLE load_test_runs ADD COLUMN job_id text;
--> statement-breakpoint
ALTER TABLE load_test_runs ADD COLUMN worker_id text;
--> statement-breakpoint
ALTER TABLE load_test_runs ADD COLUMN queued_at timestamp;
--> statement-breakpoint
-- The per-organization limit counts the organization's queued and running runs on every start.
CREATE INDEX load_test_runs_status_idx ON load_test_runs(organization_id, status);
