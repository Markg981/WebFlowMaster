\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public TO wfm_runtime;
-- Startup schema validation reads the migrator journal via information_schema.
-- Keep the runtime's journal access read-only; migrations use the admin role.
GRANT USAGE ON SCHEMA drizzle TO wfm_runtime;
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO wfm_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wfm_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wfm_runtime;
GRANT app_user TO wfm_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wfm_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wfm_runtime;
