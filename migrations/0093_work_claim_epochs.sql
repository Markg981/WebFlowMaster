-- Fencing the claims of a shared run (server/runtime/run-shards.ts, server/execution/plan-run/fence.ts;
-- audit C08 and C02, lot P11).
--
-- A work item's claim was a name and a heartbeat. A worker that stalled past the stale limit had its
-- item taken by another and, on waking, could still write the unit's result and evidence, because
-- nothing told its write from the new owner's. A claim now has an epoch, raised by every claim, and a
-- lease that ends at a database time. A result is admitted only while the writer's claim is the
-- current one (state claimed, same owner, same epoch) and its lease has not ended by the database's
-- clock, and that check runs in the transaction that writes the result.
--
-- An item whose lease ended with an attempt begun is `indeterminate`, a terminal state, unless its
-- plan's worker_loss_policy is 'replay' and the item is a single unit. Each attempt records the claim
-- epoch it was made under, so the attempts of an expired owner can be marked abandoned.
--
-- Additive: a row written before this has epoch 0 and no lease, and is read by its heartbeat as before.
ALTER TABLE run_work_items DROP CONSTRAINT run_work_items_state_check;
--> statement-breakpoint
ALTER TABLE run_work_items ADD CONSTRAINT run_work_items_state_check CHECK (state IN ('pending', 'claimed', 'done', 'indeterminate'));
--> statement-breakpoint
ALTER TABLE execution_units DROP CONSTRAINT execution_units_state_check;
--> statement-breakpoint
ALTER TABLE execution_units ADD CONSTRAINT execution_units_state_check CHECK (state IN ('planned', 'running', 'recorded', 'not_startable', 'indeterminate'));
--> statement-breakpoint
ALTER TABLE execution_unit_attempts DROP CONSTRAINT execution_unit_attempts_state_check;
--> statement-breakpoint
ALTER TABLE execution_unit_attempts ADD CONSTRAINT execution_unit_attempts_state_check CHECK (state IN ('running', 'finished', 'abandoned'));
--> statement-breakpoint
ALTER TABLE run_work_items ADD COLUMN epoch integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE run_work_items ADD COLUMN lease_expires_at timestamp;
--> statement-breakpoint
ALTER TABLE execution_unit_attempts ADD COLUMN claim_epoch integer;
--> statement-breakpoint
ALTER TABLE test_plans ADD COLUMN worker_loss_policy text NOT NULL DEFAULT 'indeterminate';
--> statement-breakpoint
ALTER TABLE test_plans ADD CONSTRAINT test_plans_worker_loss_policy_check CHECK (worker_loss_policy IN ('indeterminate', 'replay'));
