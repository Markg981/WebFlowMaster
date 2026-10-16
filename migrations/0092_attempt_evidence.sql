-- What each attempt at a unit left behind (server/execution/execution-units.ts,
-- shared/execution-identity.ts; audit C07, lot P08).
--
-- An attempt row said only that a try happened and how it ended. The evidence of a try that a
-- re-run then replaced lived in a directory the re-run wrote over, and the report kept the last
-- one's links only: the first failure of a flaky test was gone. Each attempt now writes into a
-- directory of its own and records here, before the unit's final result is written, its reason
-- and the stored paths of its evidence — per UI dataset row when it had rows.
--
-- Additive and nullable: an attempt written before this, or by a worker that predates it, has none.
ALTER TABLE execution_unit_attempts ADD COLUMN failure_reason text;
--> statement-breakpoint
ALTER TABLE execution_unit_attempts ADD COLUMN evidence jsonb;
