CREATE TABLE mail_deliveries (
  id text PRIMARY KEY,
  organization_id integer REFERENCES organizations(id) ON DELETE CASCADE,
  recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),
  purpose text NOT NULL CHECK (purpose IN ('invitation','password_reset','run_finished','other')),
  state text NOT NULL CONSTRAINT mail_deliveries_state_check CHECK (state IN ('queued','accepted','delivered','soft_bounce','hard_bounce','rejected','failed','suppressed')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mail_deliveries_id_organization_unique UNIQUE(id, organization_id)
);
--> statement-breakpoint
CREATE INDEX mail_deliveries_org_recipient_idx ON mail_deliveries(organization_id, recipient);
--> statement-breakpoint
CREATE INDEX mail_deliveries_org_created_idx ON mail_deliveries(organization_id, created_at);
--> statement-breakpoint
CREATE TABLE mail_delivery_events (
  id text PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES mail_deliveries(id) ON DELETE CASCADE,
  organization_id integer REFERENCES organizations(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('delivered','soft_bounce','hard_bounce')),
  received_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mail_delivery_events_delivery_id_same_org_fk FOREIGN KEY(delivery_id, organization_id) REFERENCES mail_deliveries(id, organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX mail_delivery_events_delivery_idx ON mail_delivery_events(delivery_id);
--> statement-breakpoint
ALTER TABLE mail_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mail_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON mail_deliveries USING(organization_id = NULLIF(current_setting('app.current_org',true),'')::integer);
--> statement-breakpoint
ALTER TABLE mail_delivery_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mail_delivery_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON mail_delivery_events USING(organization_id = NULLIF(current_setting('app.current_org',true),'')::integer);
--> statement-breakpoint
GRANT SELECT ON mail_deliveries TO app_user;
--> statement-breakpoint
GRANT SELECT ON mail_delivery_events TO app_user;
