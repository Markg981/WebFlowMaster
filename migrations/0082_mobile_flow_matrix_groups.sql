ALTER TABLE mobile_tests ADD COLUMN device_matrix jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE mobile_tests ADD CONSTRAINT mobile_device_matrix_array CHECK (jsonb_typeof(device_matrix) = 'array' AND jsonb_array_length(device_matrix) <= 20);
--> statement-breakpoint
CREATE TABLE mobile_step_groups (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  project_id integer REFERENCES projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 200),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mobile_step_groups_project_id_same_org_fk FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id)
);
--> statement-breakpoint
CREATE INDEX mobile_step_groups_org_idx ON mobile_step_groups(organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX mobile_step_groups_name_unique ON mobile_step_groups(organization_id, platform, lower(name));
--> statement-breakpoint
ALTER TABLE mobile_step_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mobile_step_groups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON mobile_step_groups
USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
CREATE POLICY project_read ON mobile_step_groups AS RESTRICTIVE FOR SELECT USING (app_project_visible(project_id));
--> statement-breakpoint
CREATE POLICY project_insert ON mobile_step_groups AS RESTRICTIVE FOR INSERT WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_update ON mobile_step_groups AS RESTRICTIVE FOR UPDATE USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_delete ON mobile_step_groups AS RESTRICTIVE FOR DELETE USING (app_project_editable(project_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON mobile_step_groups TO app_user;
--> statement-breakpoint
-- Boolean-only dependency check: a restricted test must block deletion without leaking its name.
CREATE FUNCTION app_mobile_group_used(group_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM mobile_tests t, jsonb_array_elements(t.steps) s
    WHERE t.organization_id = NULLIF(current_setting('app.current_org', true), '')::int
      AND s->>'action' = 'callGroup' AND btrim(s->>'value') = group_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mobile_group_used(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mobile_group_used(text) TO app_user;
