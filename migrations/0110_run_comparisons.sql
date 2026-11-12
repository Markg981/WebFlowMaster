-- Run comparison (docs/superpowers/specs/2026-11-12-run-comparison-design.md).
--
-- One plan, frozen once, run on two environments: the baseline is an ordinary run, the candidate
-- a replay of its snapshot on another environment. When both end, the stored results are compared
-- step by step and every test gets a verdict.
--
-- As in 0034, the single-column foreign keys carry the ON DELETE behaviour and the composite ones
-- (NO ACTION, MATCH SIMPLE so a null link is not checked) only hold the organization. Users are
-- linked through organization_memberships, as in 0089.
CREATE TABLE comparison_runs (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  test_plan_id text NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
  name text,
  baseline_environment_id integer REFERENCES environments(id) ON DELETE SET NULL,
  candidate_environment_id integer REFERENCES environments(id) ON DELETE SET NULL,
  baseline_environment_name text NOT NULL,
  candidate_environment_name text NOT NULL,
  baseline_execution_id text REFERENCES test_plan_executions(id) ON DELETE SET NULL,
  candidate_execution_id text REFERENCES test_plan_executions(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'sequential',
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  verdict text,
  summary jsonb,
  failure_code text,
  failure_message text,
  idempotency_key text,
  requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  CONSTRAINT comparison_runs_id_organization_unique UNIQUE (id, organization_id),
  CONSTRAINT comparison_runs_mode_check CHECK (mode IN ('sequential', 'parallel')),
  CONSTRAINT comparison_runs_status_check
    CHECK (status IN ('queued', 'running', 'comparing', 'completed', 'error', 'cancelled')),
  CONSTRAINT comparison_runs_verdict_check
    CHECK (verdict IS NULL OR verdict IN ('parity', 'parity_with_accepted', 'regressions', 'inconclusive')),
  CONSTRAINT comparison_runs_environments_differ
    CHECK (baseline_environment_id IS NULL OR candidate_environment_id IS NULL
      OR baseline_environment_id <> candidate_environment_id)
);
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_test_plan_id_same_org_fk
  FOREIGN KEY (test_plan_id, organization_id) REFERENCES test_plans (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_baseline_environment_id_same_org_fk
  FOREIGN KEY (baseline_environment_id, organization_id) REFERENCES environments (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_candidate_environment_id_same_org_fk
  FOREIGN KEY (candidate_environment_id, organization_id) REFERENCES environments (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_baseline_execution_id_same_org_fk
  FOREIGN KEY (baseline_execution_id, organization_id)
  REFERENCES test_plan_executions (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_candidate_execution_id_same_org_fk
  FOREIGN KEY (candidate_execution_id, organization_id)
  REFERENCES test_plan_executions (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_runs ADD CONSTRAINT comparison_runs_requested_by_user_id_same_org_fk
  FOREIGN KEY (requested_by_user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (requested_by_user_id);
--> statement-breakpoint
CREATE INDEX comparison_runs_plan_idx ON comparison_runs(test_plan_id, created_at);
--> statement-breakpoint
CREATE INDEX comparison_runs_baseline_execution_idx ON comparison_runs(baseline_execution_id);
--> statement-breakpoint
CREATE INDEX comparison_runs_candidate_execution_idx ON comparison_runs(candidate_execution_id);
--> statement-breakpoint
CREATE INDEX comparison_runs_open_idx ON comparison_runs(status)
  WHERE status IN ('queued', 'running', 'comparing');
--> statement-breakpoint
CREATE UNIQUE INDEX comparison_runs_idempotency_idx ON comparison_runs(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE comparison_results (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  comparison_run_id text NOT NULL REFERENCES comparison_runs(id) ON DELETE CASCADE,
  pair_key text NOT NULL,
  ui_test_id integer REFERENCES tests(id) ON DELETE SET NULL,
  api_test_id integer REFERENCES api_tests(id) ON DELETE SET NULL,
  test_type text,
  test_name text,
  browser text,
  module text,
  component text,
  priority text,
  severity text,
  baseline_result_id text REFERENCES report_test_case_results(id) ON DELETE SET NULL,
  candidate_result_id text REFERENCES report_test_case_results(id) ON DELETE SET NULL,
  verdict text NOT NULL,
  differences jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline_duration_ms integer,
  candidate_duration_ms integer,
  review_status text NOT NULL DEFAULT 'open',
  reviewed_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  review_note text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT comparison_results_verdict_check CHECK (verdict IN (
    'identical', 'equivalent', 'different', 'outcome_mismatch', 'both_failed', 'not_comparable'
  )),
  CONSTRAINT comparison_results_review_status_check
    CHECK (review_status IN ('open', 'accepted', 'defect'))
);
--> statement-breakpoint
ALTER TABLE comparison_results ADD CONSTRAINT comparison_results_comparison_run_id_same_org_fk
  FOREIGN KEY (comparison_run_id, organization_id)
  REFERENCES comparison_runs (id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE comparison_results ADD CONSTRAINT comparison_results_ui_test_id_same_org_fk
  FOREIGN KEY (ui_test_id, organization_id) REFERENCES tests (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_results ADD CONSTRAINT comparison_results_api_test_id_same_org_fk
  FOREIGN KEY (api_test_id, organization_id) REFERENCES api_tests (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_results ADD CONSTRAINT comparison_results_reviewed_by_user_id_same_org_fk
  FOREIGN KEY (reviewed_by_user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (reviewed_by_user_id);
--> statement-breakpoint
ALTER TABLE comparison_results ADD CONSTRAINT comparison_results_baseline_result_id_same_org_fk
  FOREIGN KEY (baseline_result_id, organization_id)
  REFERENCES report_test_case_results (id, organization_id)
  ON DELETE SET NULL (baseline_result_id);
--> statement-breakpoint
ALTER TABLE comparison_results ADD CONSTRAINT comparison_results_candidate_result_id_same_org_fk
  FOREIGN KEY (candidate_result_id, organization_id)
  REFERENCES report_test_case_results (id, organization_id)
  ON DELETE SET NULL (candidate_result_id);
--> statement-breakpoint
CREATE UNIQUE INDEX comparison_results_pair_idx ON comparison_results(comparison_run_id, pair_key);
--> statement-breakpoint
CREATE INDEX comparison_results_baseline_result_idx ON comparison_results(baseline_result_id);
--> statement-breakpoint
CREATE INDEX comparison_results_candidate_result_idx ON comparison_results(candidate_result_id);
--> statement-breakpoint
CREATE TABLE comparison_known_differences (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  project_id integer REFERENCES projects(id) ON DELETE CASCADE,
  ui_test_id integer REFERENCES tests(id) ON DELETE CASCADE,
  checkpoint_name text,
  kind text NOT NULL,
  path_pattern text,
  reason text NOT NULL,
  reference text,
  approved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp,
  CONSTRAINT comparison_known_differences_kind_check CHECK (kind IN (
    'outcome', 'text', 'table', 'chart', 'network', 'visual', 'performance'
  ))
);
--> statement-breakpoint
ALTER TABLE comparison_known_differences ADD CONSTRAINT comparison_known_differences_project_id_same_org_fk
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_known_differences ADD CONSTRAINT comparison_known_differences_ui_test_id_same_org_fk
  FOREIGN KEY (ui_test_id, organization_id) REFERENCES tests (id, organization_id);
--> statement-breakpoint
ALTER TABLE comparison_known_differences ADD CONSTRAINT comparison_known_differences_approved_by_user_id_same_org_fk
  FOREIGN KEY (approved_by_user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (approved_by_user_id);
--> statement-breakpoint
CREATE INDEX comparison_known_differences_scope_idx
  ON comparison_known_differences(organization_id, project_id, ui_test_id);
--> statement-breakpoint
ALTER TABLE comparison_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comparison_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON comparison_runs
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comparison_runs TO app_user;
--> statement-breakpoint
ALTER TABLE comparison_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comparison_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON comparison_results
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comparison_results TO app_user;
--> statement-breakpoint
ALTER TABLE comparison_known_differences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comparison_known_differences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON comparison_known_differences
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comparison_known_differences TO app_user;
