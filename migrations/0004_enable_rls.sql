-- Enabling and forcing RLS, plus one policy per org-scoped table. FORCE is required so the
-- table owner is subject to the policy too; note it does NOT subject a superuser, which is
-- why the application reaches these tables via SET LOCAL ROLE app_user.
--
-- The policy expression is NULLIF(current_setting('app.current_org', true), '')::int rather
-- than the bare current_setting(...)::int cast: a custom GUC does not revert to unset when a
-- LOCAL scope ends (Postgres bug #15646) — it springs into existence with an empty-string
-- default the first time it is touched on a backend connection, and stays '' after commit or
-- rollback, not NULL. Since db.ts pools connections, any connection that has served one
-- tenant transaction would otherwise raise a cast error on '' for every later untenanted
-- query on that same connection. That failure is closed (no cross-tenant leak), but it is a
-- 500, not the empty-result behavior an unbound connection should have. NULLIF maps '' to
-- NULL first, so the comparison is against NULL and no rows match, instead of raising.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','tests','test_runs','detected_elements','api_tests','api_test_history',
    'test_plans','test_plan_schedules','test_plan_executions','test_plan_selected_tests',
    'test_plan_webhooks','report_test_case_results','execution_logs','environments','secrets',
    'excel_sequences_map'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (NULLIF(current_setting(''app.current_org'', true), '''')::int = organization_id) WITH CHECK (NULLIF(current_setting(''app.current_org'', true), '''')::int = organization_id)',
      t
    );
  END LOOP;
END $$;
