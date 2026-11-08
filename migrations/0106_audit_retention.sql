-- Retention of personal data in audit_log and the sweep's indexes (audit M-10, M-12).
--
-- Plain CREATE INDEX IF NOT EXISTS, not CONCURRENTLY: the migrator runs each file in a
-- transaction, where CONCURRENTLY is refused. The tables are written briefly while the index is
-- built; for a very large installation create the same indexes CONCURRENTLY by hand beforehand
-- (IF NOT EXISTS makes this migration a no-op then).
--
-- audit_log already has audit_log_created_at_idx (0009) for the DELETE; the IP sweep filters on
-- created_at AND ip_address IS NOT NULL, so a partial index keeps it from re-reading cleared rows.
CREATE INDEX IF NOT EXISTS audit_log_ip_created_at_idx
  ON audit_log (created_at) WHERE ip_address IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS execution_unit_attempts_evidence_finished_at_idx
  ON execution_unit_attempts (finished_at) WHERE evidence IS NOT NULL OR failure_reason IS NOT NULL;
--> statement-breakpoint
-- Member removal pseudonymizes the person's name in their audit entries. The 0102 trigger refuses
-- UPDATE for every role and app_user has no UPDATE grant, so the application cannot do it
-- directly. This function (owned by the migrator role, the table owner) changes exactly one
-- column, actor_username, of the entries of one person in the caller's organization, and opens the
-- trigger's maintenance switch only for that statement. The trigger still refuses DELETE.
CREATE OR REPLACE FUNCTION audit_pseudonymize_actor(p_user integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  org integer := NULLIF(current_setting('app.current_org', true), '')::integer;
  changed integer;
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'tenant_context_required'; END IF;
  PERFORM set_config('app.audit_maintenance', 'on', true);
  UPDATE public.audit_log
     SET actor_username = 'removed-user-' || substr(md5(org::text || ':' || p_user::text), 1, 8)
   WHERE organization_id = org AND actor_user_id = p_user;
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('app.audit_maintenance', 'off', true);
  RETURN changed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_pseudonymize_actor(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_pseudonymize_actor(integer) TO app_user;
