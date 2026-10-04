ALTER TABLE tests ADD COLUMN bdd jsonb CHECK (bdd IS NULL OR jsonb_typeof(bdd) = 'object');
--> statement-breakpoint
ALTER TABLE test_versions ADD COLUMN bdd jsonb CHECK (bdd IS NULL OR jsonb_typeof(bdd) = 'object');
--> statement-breakpoint
ALTER TABLE agents ADD COLUMN bdd_profiles jsonb;
--> statement-breakpoint
CREATE TABLE bdd_execution_profiles (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id integer REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, pool text NOT NULL, operator_profile_id text NOT NULL,
  revision text NOT NULL, timeout_ms integer NOT NULL DEFAULT 60000 CHECK(timeout_ms BETWEEN 1000 AND 300000),
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX bdd_execution_profiles_organization_idx ON bdd_execution_profiles(organization_id);
--> statement-breakpoint
ALTER TABLE bdd_execution_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bdd_execution_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bdd_profile_read ON bdd_execution_profiles FOR SELECT USING (
 organization_id = NULLIF(current_setting('app.current_org', true),'')::integer AND
 (project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE projects.id = project_id))
);
--> statement-breakpoint
CREATE POLICY bdd_profile_insert ON bdd_execution_profiles FOR INSERT WITH CHECK (
 organization_id = NULLIF(current_setting('app.current_org', true),'')::integer AND
 current_setting('app.current_user_role', true) = 'owner' AND
 (project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE projects.id = project_id AND projects.organization_id = bdd_execution_profiles.organization_id))
);
--> statement-breakpoint
CREATE POLICY bdd_profile_update ON bdd_execution_profiles FOR UPDATE USING (
 organization_id = NULLIF(current_setting('app.current_org', true),'')::integer AND current_setting('app.current_user_role', true) = 'owner'
) WITH CHECK (
 organization_id = NULLIF(current_setting('app.current_org', true),'')::integer AND current_setting('app.current_user_role', true) = 'owner' AND
 (project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE projects.id = project_id AND projects.organization_id = bdd_execution_profiles.organization_id))
);
--> statement-breakpoint
CREATE POLICY bdd_profile_delete ON bdd_execution_profiles FOR DELETE USING (
 organization_id = NULLIF(current_setting('app.current_org', true),'')::integer AND current_setting('app.current_user_role', true) = 'owner'
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bdd_execution_profiles TO app_user;
