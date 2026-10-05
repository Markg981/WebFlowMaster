ALTER TABLE organizations
  ADD COLUMN quota_mode text CHECK (quota_mode IN ('off','monitor','enforce')),
  ADD COLUMN max_tests bigint CHECK (max_tests BETWEEN 0 AND 9007199254740991),
  ADD COLUMN max_artifact_bytes bigint CHECK (max_artifact_bytes BETWEEN 0 AND 9007199254740991),
  ADD COLUMN max_monthly_execution_minutes bigint CHECK (max_monthly_execution_minutes BETWEEN 0 AND 9007199254740991),
  ADD COLUMN quota_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN artifacts_reconciled_at timestamp;
--> statement-breakpoint
ALTER TABLE test_plan_executions ADD COLUMN artifact_storage_status text CHECK (artifact_storage_status IN ('quota_exceeded','error'));
--> statement-breakpoint
CREATE TABLE quota_installation_defaults (
  id integer PRIMARY KEY CHECK (id = 1),
  mode text NOT NULL CHECK (mode IN ('off','monitor','enforce')),
  max_tests bigint NOT NULL CHECK (max_tests BETWEEN 0 AND 9007199254740991)
  ,max_artifact_bytes bigint NOT NULL DEFAULT 0 CHECK (max_artifact_bytes BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
INSERT INTO quota_installation_defaults VALUES (1,'enforce',0,0);
--> statement-breakpoint
REVOKE ALL ON quota_installation_defaults FROM PUBLIC, app_user;
--> statement-breakpoint
CREATE TABLE quota_execution_sessions (
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan','shard','browser','api','mobile')),
  execution_id text NOT NULL,
  started_at timestamp NOT NULL,
  heartbeat_at timestamp NOT NULL,
  ended_at timestamp CHECK (ended_at IS NULL OR ended_at >= started_at),
  PRIMARY KEY (organization_id,kind,execution_id)
);
--> statement-breakpoint
CREATE INDEX quota_execution_period_idx ON quota_execution_sessions(organization_id,started_at);
--> statement-breakpoint
CREATE TABLE quota_artifacts (
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes BETWEEN 0 AND 9007199254740991),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes BETWEEN 0 AND 9007199254740991),
  reservation_id text,
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,key)
);
--> statement-breakpoint
ALTER TABLE quota_execution_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quota_execution_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON quota_execution_sessions USING (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer);
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON quota_execution_sessions TO app_user;
--> statement-breakpoint
ALTER TABLE quota_artifacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quota_artifacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON quota_artifacts USING (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer);
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON quota_artifacts TO app_user;
--> statement-breakpoint
-- Aggregates bypass project filters, but never the caller's organization boundary.
CREATE FUNCTION app_quota_usage(p_now timestamp DEFAULT (now() AT TIME ZONE 'UTC'))
RETURNS TABLE(tests bigint,artifact_bytes numeric,reserved_artifact_bytes numeric,execution_ms numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE org integer := NULLIF(current_setting('app.current_org',true),'')::integer;
DECLARE period_start timestamp := date_trunc('month',p_now);
DECLARE period_end timestamp := date_trunc('month',p_now) + interval '1 month';
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'tenant_context_required'; END IF;
  RETURN QUERY SELECT
    ((SELECT count(*) FROM public.tests t WHERE t.organization_id=org) +
     (SELECT count(*) FROM public.api_tests t WHERE t.organization_id=org) +
     (SELECT count(*) FROM public.mobile_tests t WHERE t.organization_id=org)),
    COALESCE((SELECT sum(a.bytes) FROM public.quota_artifacts a WHERE a.organization_id=org),0),
    COALESCE((SELECT sum(a.reserved_bytes) FROM public.quota_artifacts a WHERE a.organization_id=org),0),
    COALESCE((SELECT sum(GREATEST(0,extract(epoch FROM (
      LEAST(COALESCE(s.ended_at,LEAST(p_now,s.heartbeat_at+interval '2 minutes')),period_end) -
      GREATEST(s.started_at,period_start))) * 1000))
      FROM public.quota_execution_sessions s WHERE s.organization_id=org
      AND s.started_at < period_end AND (s.ended_at IS NULL OR s.ended_at > period_start)),0);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_quota_usage(timestamp) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_quota_usage(timestamp) TO app_user;
--> statement-breakpoint
CREATE FUNCTION app_enforce_test_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cap bigint; DECLARE mode text; DECLARE used bigint;
BEGIN
  -- Serialize all definition types, even when the member cannot see every project.
  IF current_setting('role',true)='app_user' AND NEW.organization_id IS DISTINCT FROM NULLIF(current_setting('app.current_org',true),'')::integer THEN
    RAISE EXCEPTION 'tenant_context_required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(7302,NEW.organization_id);
  SELECT COALESCE(o.max_tests,d.max_tests),COALESCE(o.quota_mode,d.mode)
    INTO cap,mode FROM public.organizations o CROSS JOIN public.quota_installation_defaults d
    WHERE o.id=NEW.organization_id AND d.id=1;
  IF mode='enforce' AND cap > 0 THEN
    SELECT (SELECT count(*) FROM public.tests WHERE organization_id=NEW.organization_id) +
      (SELECT count(*) FROM public.api_tests WHERE organization_id=NEW.organization_id) +
      (SELECT count(*) FROM public.mobile_tests WHERE organization_id=NEW.organization_id) INTO used;
    IF used >= cap THEN
      RAISE EXCEPTION 'test_quota_exceeded' USING ERRCODE='P0001',
        DETAIL=json_build_object('dimension','tests','usage',used,'limit',cap)::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_enforce_test_quota() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER tests_quota BEFORE INSERT ON tests FOR EACH ROW EXECUTE FUNCTION app_enforce_test_quota();
--> statement-breakpoint
CREATE TRIGGER api_tests_quota BEFORE INSERT ON api_tests FOR EACH ROW EXECUTE FUNCTION app_enforce_test_quota();
--> statement-breakpoint
CREATE TRIGGER mobile_tests_quota BEFORE INSERT ON mobile_tests FOR EACH ROW EXECUTE FUNCTION app_enforce_test_quota();
--> statement-breakpoint
-- Historical usage survives subsequent deletion of the source report or plan.
INSERT INTO quota_execution_sessions(organization_id,kind,execution_id,started_at,heartbeat_at,ended_at)
SELECT organization_id,'plan',id,started_at,COALESCE(heartbeat_at,started_at),
  CASE WHEN status IN ('completed','failed','error','cancelled','timed_out') THEN GREATEST(completed_at,started_at) ELSE NULL END
FROM test_plan_executions WHERE started_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE mobile_test_runs ADD COLUMN artifact_storage_status text CHECK (artifact_storage_status IN ('quota_exceeded','error'));
--> statement-breakpoint
-- Mobile screenshots are retained as text in the database, outside the object store.
CREATE FUNCTION app_track_mobile_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org integer; DECLARE artifact_key text; DECLARE size bigint; DECLARE previous_bytes bigint;
DECLARE cap bigint; DECLARE mode text; DECLARE reconciled timestamp; DECLARE used numeric;
BEGIN
  org := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  artifact_key := 'mobile-inline/org_' || org || '/' || CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END || '/screenshot';
  IF current_setting('role',true)='app_user' AND org IS DISTINCT FROM NULLIF(current_setting('app.current_org',true),'')::integer THEN
    RAISE EXCEPTION 'tenant_context_required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(7304,org);
  IF TG_OP='DELETE' THEN
    DELETE FROM public.quota_artifacts WHERE organization_id=org AND key=artifact_key;
    RETURN OLD;
  END IF;
  IF NEW.screenshot IS NULL THEN
    DELETE FROM public.quota_artifacts WHERE organization_id=org AND key=artifact_key;
    RETURN NEW;
  END IF;
  size := octet_length(NEW.screenshot);
  SELECT bytes INTO previous_bytes FROM public.quota_artifacts WHERE organization_id=org AND key=artifact_key;
  previous_bytes := COALESCE(previous_bytes,0);
  SELECT COALESCE(o.max_artifact_bytes,d.max_artifact_bytes),COALESCE(o.quota_mode,d.mode),o.artifacts_reconciled_at
    INTO cap,mode,reconciled FROM public.organizations o CROSS JOIN public.quota_installation_defaults d WHERE o.id=org AND d.id=1;
  IF mode='enforce' AND cap>0 AND size>previous_bytes THEN
    SELECT COALESCE(sum(bytes+reserved_bytes),0) INTO used FROM public.quota_artifacts WHERE organization_id=org;
    IF reconciled IS NULL OR used+size-previous_bytes>cap THEN
      NEW.screenshot := CASE WHEN TG_OP='UPDATE' THEN OLD.screenshot ELSE NULL END;
      NEW.artifact_storage_status := CASE WHEN reconciled IS NULL THEN 'error' ELSE 'quota_exceeded' END;
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO public.quota_artifacts(organization_id,key,bytes) VALUES (org,artifact_key,size)
    ON CONFLICT(organization_id,key) DO UPDATE SET bytes=excluded.bytes,updated_at=now();
  NEW.artifact_storage_status := NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_track_mobile_evidence() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER mobile_evidence_insert BEFORE INSERT ON mobile_test_runs FOR EACH ROW EXECUTE FUNCTION app_track_mobile_evidence();
--> statement-breakpoint
CREATE TRIGGER mobile_evidence_update BEFORE UPDATE OF screenshot ON mobile_test_runs FOR EACH ROW EXECUTE FUNCTION app_track_mobile_evidence();
--> statement-breakpoint
CREATE TRIGGER mobile_evidence_delete BEFORE DELETE ON mobile_test_runs FOR EACH ROW EXECUTE FUNCTION app_track_mobile_evidence();
--> statement-breakpoint
ALTER TABLE test_plan_executions ADD COLUMN quota_defer_reason text CHECK(quota_defer_reason IN ('execution_quota_exceeded','concurrent_run_quota')), ADD COLUMN quota_defer_until timestamp;
