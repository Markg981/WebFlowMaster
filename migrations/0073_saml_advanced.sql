ALTER TABLE organization_sso ADD COLUMN saml_allow_idp_initiated boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE organization_sso ADD COLUMN saml_require_encrypted_assertions boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE organization_sso ADD COLUMN saml_slo_url text;
--> statement-breakpoint
ALTER TABLE organization_sso ADD COLUMN saml_sp_certificate text;
--> statement-breakpoint
ALTER TABLE organization_sso ADD COLUMN saml_sp_private_key_encrypted text;
--> statement-breakpoint
ALTER TABLE organization_sso ADD COLUMN saml_sp_private_key_iv text;
--> statement-breakpoint
ALTER TABLE organization_sso ADD COLUMN saml_sp_private_key_auth_tag text;
--> statement-breakpoint
ALTER TABLE sso_saml_requests ADD COLUMN purpose text NOT NULL DEFAULT 'authn';
--> statement-breakpoint
ALTER TABLE sso_saml_requests ADD COLUMN session_id text;
--> statement-breakpoint
CREATE TABLE sso_saml_replay (id text PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, expires_at timestamp NOT NULL);
--> statement-breakpoint
CREATE INDEX sso_saml_replay_expires_at_idx ON sso_saml_replay(expires_at);
--> statement-breakpoint
CREATE TABLE sso_saml_sessions (session_id text PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, issuer text NOT NULL, name_id text NOT NULL, name_id_format text, session_index text, created_at timestamp NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX sso_saml_sessions_identity_idx ON sso_saml_sessions(organization_id, issuer, name_id, session_index);
--> statement-breakpoint
ALTER TABLE sso_saml_sessions ADD CONSTRAINT sso_saml_sessions_user_id_same_org_fk FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id);
