-- Sequential comparisons: how long the candidate waits after the baseline has ended, for a system
-- under test that keeps working after a run and would otherwise slow the candidate down.
ALTER TABLE comparison_runs ADD COLUMN candidate_delay_seconds integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_candidate_delay_range
  CHECK (candidate_delay_seconds BETWEEN 0 AND 7200);
