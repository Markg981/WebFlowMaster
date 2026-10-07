-- Load tests (shared/load-test.ts): API tests repeated by virtual users along a profile of stages,
-- with a warm-up and a data row per user. They run on their own (server/load-runner.ts), never in a
-- plan, and each run keeps its live summary and its verdict here.
-- The data set a load test reads must be its organization's, like every other link (0034).
ALTER TABLE test_data_sets ADD CONSTRAINT test_data_sets_id_organization_unique UNIQUE (id, organization_id);
--> statement-breakpoint
CREATE TABLE load_tests (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 20),
  stages jsonb NOT NULL CHECK (jsonb_typeof(stages) = 'array' AND jsonb_array_length(stages) BETWEEN 1 AND 10),
  warm_up_sec integer NOT NULL DEFAULT 0 CHECK (warm_up_sec >= 0),
  data_set_id integer REFERENCES test_data_sets(id) ON DELETE SET NULL,
  data_mode text NOT NULL DEFAULT 'vu' CHECK (data_mode IN ('vu', 'iteration')),
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(thresholds) = 'object'),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT load_tests_id_organization_unique UNIQUE (id, organization_id),
  CONSTRAINT load_tests_project_id_same_org_fk FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
  CONSTRAINT load_tests_data_set_id_same_org_fk FOREIGN KEY (data_set_id, organization_id) REFERENCES test_data_sets(id, organization_id)
);
--> statement-breakpoint
CREATE INDEX load_tests_org_idx ON load_tests(organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX load_tests_name_unique ON load_tests(organization_id, lower(name));
--> statement-breakpoint
CREATE TABLE load_test_runs (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  load_test_id integer NOT NULL REFERENCES load_tests(id) ON DELETE CASCADE,
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  environment_id integer REFERENCES environments(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'cancelled', 'error')),
  definition jsonb NOT NULL,
  summary jsonb,
  error text,
  cancel_requested boolean NOT NULL DEFAULT false,
  heartbeat_at timestamp,
  requested_by integer REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  CONSTRAINT load_test_runs_load_test_id_same_org_fk FOREIGN KEY (load_test_id, organization_id) REFERENCES load_tests(id, organization_id),
  CONSTRAINT load_test_runs_project_id_same_org_fk FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id),
  CONSTRAINT load_test_runs_environment_id_same_org_fk FOREIGN KEY (environment_id, organization_id) REFERENCES environments(id, organization_id)
);
--> statement-breakpoint
CREATE INDEX load_test_runs_test_idx ON load_test_runs(load_test_id, started_at);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['load_tests', 'load_test_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    -- A load test in a restricted project is the project's, and so are its runs (copied project_id).
    EXECUTE format('CREATE POLICY project_read ON %I AS RESTRICTIVE FOR SELECT USING (app_project_visible(project_id))', t);
    EXECUTE format('CREATE POLICY project_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_project_editable(project_id))', t);
    EXECUTE format('CREATE POLICY project_update ON %I AS RESTRICTIVE FOR UPDATE USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id))', t);
    EXECUTE format('CREATE POLICY project_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_project_editable(project_id))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE load_tests_id_seq TO app_user;
