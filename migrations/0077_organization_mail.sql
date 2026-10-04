CREATE TABLE organization_mail_settings (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  smtp_mode text NOT NULL DEFAULT 'inherit' CHECK (smtp_mode IN ('inherit','custom','disabled')),
  provider text NOT NULL DEFAULT 'none' CHECK (provider IN ('none','generic','ses','sendgrid','mailgun')),
  callback_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  smtp_host text, smtp_port integer NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_username text, smtp_password jsonb, smtp_secure integer NOT NULL DEFAULT 0 CHECK (smtp_secure IN (0,1)),
  from_address text, signing_secret jsonb, sendgrid_public_key text, ses_topic_arn text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE organization_mail_templates (
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('invitation','password_reset','run_finished')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 254 AND subject !~ E'[\\r\\n]'),
  html text NOT NULL CHECK (length(html) BETWEEN 1 AND 50000),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  custom boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,purpose)
);
--> statement-breakpoint
ALTER TABLE organization_mail_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_mail_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organization_mail_settings
  USING (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer AND current_setting('app.current_user_role',true) = 'owner')
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer AND current_setting('app.current_user_role',true) = 'owner');
--> statement-breakpoint
ALTER TABLE organization_mail_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_mail_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organization_mail_templates
  USING (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer AND current_setting('app.current_user_role',true) = 'owner')
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer AND current_setting('app.current_user_role',true) = 'owner');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_mail_settings, organization_mail_templates TO app_user;
--> statement-breakpoint
CREATE TABLE mail_provider_requests (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body_hash text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'), expires_at timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX mail_provider_requests_expiry_idx ON mail_provider_requests(expires_at);
--> statement-breakpoint
ALTER TABLE mail_provider_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mail_provider_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON mail_provider_requests USING (organization_id = NULLIF(current_setting('app.current_org',true),'')::integer AND current_setting('app.current_user_role',true) = 'owner');
--> statement-breakpoint
GRANT SELECT ON mail_provider_requests TO app_user;
