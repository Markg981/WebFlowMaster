-- Billing: plans, one subscription per organization, and an append-only ledger
-- (shared/billing.ts, server/billing/). Self-hosted installations change nothing: every
-- organization is backfilled onto a free plan whose limits are the installation's defaults.
--
-- Quota precedence, written down once and used by the triggers below and by
-- server/tenant-quotas.ts: an installation administrator's override on the organization's row
-- wins; then the plan the organization subscribes to; then the installation default.
CREATE TABLE billing_plans (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  name text NOT NULL,
  price_month_minor bigint NOT NULL DEFAULT 0 CHECK (price_month_minor BETWEEN 0 AND 9007199254740991),
  price_year_minor bigint NOT NULL DEFAULT 0 CHECK (price_year_minor BETWEEN 0 AND 9007199254740991),
  currency text NOT NULL DEFAULT 'eur' CHECK (currency ~ '^[a-z]{3}$'),
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 3650),
  active boolean NOT NULL DEFAULT true,
  max_concurrent_runs integer CHECK (max_concurrent_runs IS NULL OR max_concurrent_runs >= 1),
  max_queued_runs integer CHECK (max_queued_runs IS NULL OR max_queued_runs >= 1),
  max_tests bigint CHECK (max_tests IS NULL OR max_tests BETWEEN 0 AND 9007199254740991),
  max_artifact_bytes bigint CHECK (max_artifact_bytes IS NULL OR max_artifact_bytes BETWEEN 0 AND 9007199254740991),
  max_monthly_execution_minutes bigint CHECK (max_monthly_execution_minutes IS NULL OR max_monthly_execution_minutes BETWEEN 0 AND 9007199254740991),
  provider_price_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The catalogue is the installation's: readable inside any organization, changed by nobody but
-- the installation administrator on the privileged handle.
GRANT SELECT ON TABLE billing_plans TO app_user;
--> statement-breakpoint
-- The plan every existing organization is on. Its limits are NULL: the installation's defaults,
-- exactly what applied before this migration.
INSERT INTO billing_plans (code, name) VALUES ('free', 'Free');
--> statement-breakpoint
CREATE TABLE organization_subscriptions (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES billing_plans(code),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  interval text CHECK (interval IS NULL OR interval IN ('month','year')),
  current_period_start timestamp,
  current_period_end timestamp,
  trial_ends_at timestamp,
  past_due_since timestamp,
  provider text NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','stripe')),
  provider_customer_id text,
  provider_subscription_id text,
  suspended_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT organization_subscriptions_organization_unique UNIQUE (organization_id)
);
--> statement-breakpoint
CREATE INDEX organization_subscriptions_provider_subscription_idx ON organization_subscriptions(provider_subscription_id);
--> statement-breakpoint
-- Every organization so far: the free plan, active, as if nothing had changed.
INSERT INTO organization_subscriptions (organization_id, plan_code, status, provider)
  SELECT id, 'free', 'active', 'manual' FROM organizations;
--> statement-breakpoint
ALTER TABLE organization_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organization_subscriptions
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- Members read their own organization's subscription. Nothing inside an organization moves it:
-- the provider's webhook, the installation administrator and the daily sweep are privileged.
GRANT SELECT ON TABLE organization_subscriptions TO app_user;
--> statement-breakpoint
-- A new organization — registration, single sign-on, an operator's script — starts on the free
-- plan without every path that creates one having to know. SECURITY DEFINER: app_user cannot
-- insert into organizations anyway, but the trigger writes as the table's owner regardless.
CREATE FUNCTION app_default_subscription() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO organization_subscriptions (organization_id, plan_code, status, provider)
  VALUES (NEW.id, 'free', 'active', 'manual')
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER organizations_default_subscription
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION app_default_subscription();
--> statement-breakpoint
CREATE TABLE billing_events (
  id serial PRIMARY KEY,
  organization_id integer REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('webhook','manual','sweep')),
  provider text NOT NULL,
  type text NOT NULL,
  actor text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX billing_events_organization_idx ON billing_events(organization_id, created_at);
--> statement-breakpoint
-- A ledger of what the provider said and what administrators did: nobody's but the operator's.
REVOKE ALL ON TABLE billing_events FROM PUBLIC, app_user;
--> statement-breakpoint
-- The triggers of migration 0081, with the plan between the organization's override and the
-- installation default. The bodies are otherwise unchanged.
CREATE OR REPLACE FUNCTION app_enforce_test_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cap bigint; DECLARE mode text; DECLARE used bigint;
BEGIN
  -- Serialize all definition types, even when the member cannot see every project.
  IF current_setting('role',true)='app_user' AND NEW.organization_id IS DISTINCT FROM NULLIF(current_setting('app.current_org',true),'')::integer THEN
    RAISE EXCEPTION 'tenant_context_required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(7302,NEW.organization_id);
  SELECT COALESCE(o.max_tests,p.max_tests,d.max_tests),COALESCE(o.quota_mode,d.mode)
    INTO cap,mode FROM public.organizations o CROSS JOIN public.quota_installation_defaults d
    LEFT JOIN public.organization_subscriptions s ON s.organization_id=o.id
    LEFT JOIN public.billing_plans p ON p.code=s.plan_code
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
CREATE OR REPLACE FUNCTION app_track_mobile_evidence() RETURNS trigger
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
  SELECT COALESCE(o.max_artifact_bytes,p.max_artifact_bytes,d.max_artifact_bytes),COALESCE(o.quota_mode,d.mode),o.artifacts_reconciled_at
    INTO cap,mode,reconciled FROM public.organizations o CROSS JOIN public.quota_installation_defaults d
    LEFT JOIN public.organization_subscriptions s ON s.organization_id=o.id
    LEFT JOIN public.billing_plans p ON p.code=s.plan_code
    WHERE o.id=org AND d.id=1;
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
