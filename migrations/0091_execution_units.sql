-- The manifest of a run and the attempts at each of its units (server/execution/execution-units.ts,
-- shared/execution-identity.ts; audit C02/C07/C08, lot P07).
--
-- A run knew its results only by what they said about themselves: a name, a browser label, how
-- many rows there were. Two occurrences of one test, one test in two languages, or two rows of a
-- BDD dataset were indistinguishable, and "every test has a result" was a count. The units a run
-- expects are now written here once, before any of them starts — including those of a browser the
-- plan asked for and that would not start — and every attempt and result points at one of them.
--
-- Additive: rows written before this have no unit and keep none. Nothing is backfilled, because an
-- identity worked out after the fact from names and counts is exactly what this replaces.
CREATE TABLE execution_units (
  execution_id text NOT NULL REFERENCES test_plan_executions(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id),
  unit_id text NOT NULL CHECK (unit_id ~ '^u_[0-9a-f]{24}$'),
  position integer NOT NULL CHECK (position >= 0),
  coordinates jsonb NOT NULL,
  state text NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned', 'running', 'recorded', 'not_startable')),
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, unit_id),
  CONSTRAINT execution_units_position_unique UNIQUE (execution_id, position),
  CONSTRAINT execution_units_org_unique UNIQUE (execution_id, organization_id, unit_id)
);
--> statement-breakpoint
-- The run is of the same organization as the unit, as every cross-table link is.
ALTER TABLE execution_units ADD CONSTRAINT execution_units_execution_id_same_org_fk
  FOREIGN KEY (execution_id, organization_id) REFERENCES test_plan_executions (id, organization_id)
  ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX execution_units_organization_id_idx ON execution_units(organization_id);
--> statement-breakpoint
CREATE TABLE execution_unit_attempts (
  execution_id text NOT NULL,
  organization_id integer NOT NULL REFERENCES organizations(id),
  unit_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'finished')),
  status text,
  worker text,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  PRIMARY KEY (execution_id, unit_id, attempt),
  CONSTRAINT execution_unit_attempts_org_unique
    UNIQUE (execution_id, organization_id, unit_id, attempt),
  -- An attempt is at a unit of the manifest, of the same organization.
  CONSTRAINT execution_unit_attempts_unit_fk
    FOREIGN KEY (execution_id, organization_id, unit_id)
    REFERENCES execution_units (execution_id, organization_id, unit_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX execution_unit_attempts_organization_id_idx ON execution_unit_attempts(organization_id);
--> statement-breakpoint
-- The result row stays the report's projection. A new row names its unit and the attempt that
-- decided it; a historical row has neither, and the foreign keys (MATCH SIMPLE) leave it alone.
ALTER TABLE report_test_case_results ADD COLUMN execution_unit_id text;
--> statement-breakpoint
ALTER TABLE report_test_case_results ADD COLUMN unit_attempt integer;
--> statement-breakpoint
ALTER TABLE report_test_case_results ADD CONSTRAINT report_test_case_results_unit_fk
  FOREIGN KEY (test_plan_execution_id, organization_id, execution_unit_id)
  REFERENCES execution_units (execution_id, organization_id, unit_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE report_test_case_results ADD CONSTRAINT report_test_case_results_unit_attempt_fk
  FOREIGN KEY (test_plan_execution_id, organization_id, execution_unit_id, unit_attempt)
  REFERENCES execution_unit_attempts (execution_id, organization_id, unit_id, attempt)
  ON DELETE CASCADE;
--> statement-breakpoint
-- An attempt is always of a unit. A unit's result may name none: a skipped, manual or unrunnable
-- unit is recorded without anything having been tried.
ALTER TABLE report_test_case_results ADD CONSTRAINT report_test_case_results_unit_attempt_pair
  CHECK (unit_attempt IS NULL OR execution_unit_id IS NOT NULL);
--> statement-breakpoint
-- One final result per unit: a second write for the same unit is refused, not added.
CREATE UNIQUE INDEX report_test_case_results_unit_unique
  ON report_test_case_results(test_plan_execution_id, execution_unit_id)
  WHERE execution_unit_id IS NOT NULL;
--> statement-breakpoint
-- Org-scoped like the run they belong to.
ALTER TABLE execution_units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE execution_units FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON execution_units
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
ALTER TABLE execution_unit_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE execution_unit_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON execution_unit_attempts
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE execution_units TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE execution_unit_attempts TO app_user;
