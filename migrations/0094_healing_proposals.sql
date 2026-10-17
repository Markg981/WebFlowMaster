-- Healing as a proposal, approved by a person (server/authoring/healing-proposals.ts,
-- shared/healing.ts; audit M02, lot P13).
--
-- A run that repaired a locator used to write the repair into the test, the step group or the
-- shared element itself, as the system, while the run was going. A run now only uses the repair
-- for itself and leaves a row here: which run, unit and attempt, where the step is written, the
-- fingerprint of the step as the run read it, and the locator before and after. Approving it is a
-- member's act (editor or owner on the project), audited, and writes the working copy under the
-- same fingerprint check; a source that changed since makes the proposal stale instead.
--
-- Additive: nothing reads or writes this before P13, and nothing is backfilled.
CREATE TABLE healing_proposals (
  id text PRIMARY KEY CHECK (id ~ '^hp_[0-9a-f]{24}$'),
  organization_id integer NOT NULL REFERENCES organizations(id),
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  test_id integer NOT NULL,
  -- The run as it named itself. A unit and attempt only for a plan run with a manifest.
  execution_id text,
  unit_id text,
  attempt integer CHECK (attempt IS NULL OR attempt >= 1),
  -- The runner's position: what the report shows, never where the repair goes.
  step_index integer NOT NULL CHECK (step_index >= 0),
  target_kind text NOT NULL CHECK (target_kind IN ('test', 'group', 'element')),
  -- The test id, the group id or the element id.
  target_ref text NOT NULL,
  -- Position in the test's or the group's sequence as written; null for an element.
  target_index integer CHECK (target_index IS NULL OR target_index >= 0),
  step_id text,
  call_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_fingerprint text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('fallback', 'ai')),
  selector_before text,
  selector_after text NOT NULL CHECK (length(selector_after) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'stale')),
  -- Why it went stale, or the reviewer's note.
  reason text,
  decided_by integer REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamp,
  -- The working-copy version an approved test repair was recorded as.
  applied_version integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT healing_proposals_unit_pair CHECK (attempt IS NULL OR unit_id IS NOT NULL),
  CONSTRAINT healing_proposals_decided CHECK ((status IN ('proposed', 'stale')) OR decided_at IS NOT NULL)
);
--> statement-breakpoint
-- The test is of the same organization, as every cross-table link is.
ALTER TABLE healing_proposals ADD CONSTRAINT healing_proposals_test_id_same_org_fk
  FOREIGN KEY (test_id, organization_id) REFERENCES tests (id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
-- So is the project; deleting it still sets the column null (the single-column key above).
ALTER TABLE healing_proposals ADD CONSTRAINT healing_proposals_project_id_same_org_fk
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id);
--> statement-breakpoint
-- An attempt named is an attempt of that run's manifest (MATCH SIMPLE: none named, none checked).
ALTER TABLE healing_proposals ADD CONSTRAINT healing_proposals_attempt_fk
  FOREIGN KEY (execution_id, organization_id, unit_id, attempt)
  REFERENCES execution_unit_attempts (execution_id, organization_id, unit_id, attempt)
  ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX healing_proposals_organization_id_idx ON healing_proposals(organization_id);
--> statement-breakpoint
CREATE INDEX healing_proposals_test_id_idx ON healing_proposals(test_id);
--> statement-breakpoint
CREATE INDEX healing_proposals_execution_id_idx ON healing_proposals(execution_id);
--> statement-breakpoint
-- One open proposal per source, as read, and locator: a second run that heals the same step the
-- same way finds the first one instead of adding another.
CREATE UNIQUE INDEX healing_proposals_open_unique
  ON healing_proposals(organization_id, target_kind, target_ref, COALESCE(target_index, -1),
                       source_fingerprint, selector_after)
  WHERE status = 'proposed';
--> statement-breakpoint
ALTER TABLE healing_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE healing_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON healing_proposals
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- A restricted project's proposals are its own (migration 0031). Recording one changes nothing,
-- so whoever can see the project's test can record it; deciding it is an edit of the project.
CREATE POLICY project_read ON healing_proposals AS RESTRICTIVE FOR SELECT
  USING (app_project_visible(project_id));
--> statement-breakpoint
CREATE POLICY project_insert ON healing_proposals AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_project_visible(project_id));
--> statement-breakpoint
CREATE POLICY project_update ON healing_proposals AS RESTRICTIVE FOR UPDATE
  USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_delete ON healing_proposals AS RESTRICTIVE FOR DELETE
  USING (app_project_editable(project_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE healing_proposals TO app_user;
