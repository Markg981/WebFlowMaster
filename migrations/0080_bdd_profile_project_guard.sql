ALTER TABLE bdd_execution_profiles ADD CONSTRAINT bdd_execution_profiles_project_id_same_org_fk
FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE;
