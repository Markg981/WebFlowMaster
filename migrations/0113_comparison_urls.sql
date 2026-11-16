-- Comparing two versions by address (docs/superpowers/specs/2026-11-16-comparison-urls-design.md).
-- Each side may name the URL it runs against instead of, or as well as, an environment; a
-- candidate without an environment runs with the baseline's. The sides must still differ, now
-- by environment or by address. recorded_url is where the tests were recorded, when neither.
ALTER TABLE comparison_runs ADD COLUMN baseline_url text;
--> statement-breakpoint
ALTER TABLE comparison_runs ADD COLUMN candidate_url text;
--> statement-breakpoint
ALTER TABLE comparison_runs ADD COLUMN recorded_url text;
--> statement-breakpoint
ALTER TABLE comparison_runs DROP CONSTRAINT comparison_runs_environments_differ;
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_sides_differ
  CHECK (
    baseline_url IS DISTINCT FROM candidate_url
    OR baseline_environment_id IS NULL
    OR candidate_environment_id IS NULL
    OR baseline_environment_id <> candidate_environment_id
  );
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_url_length
  CHECK (
    coalesce(length(baseline_url), 0) <= 2048
    AND coalesce(length(candidate_url), 0) <= 2048
    AND coalesce(length(recorded_url), 0) <= 2048
  );
