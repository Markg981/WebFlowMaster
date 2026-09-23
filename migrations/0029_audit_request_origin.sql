-- Where an audited action came from, beside who did it.
--
-- The trail named a user and nothing else. Now that a key can act as a user (and a service
-- account exists only to hold keys), "marco deleted the checkout plan" does not say whether
-- marco did it or a pipeline holding one of marco's keys did — and that is the first question
-- anyone asks of an entry like that. The address answers the second one.
--
--   api_key_id  — the key the request authenticated with; null for a session.
--   ip_address  — the client's address as the application saw it (behind a proxy, the one the
--                 proxy reports; see "trust proxy").
--
-- Plain columns rather than metadata: they are filtered on, and metadata is free-form.
ALTER TABLE "audit_log"
  ADD COLUMN "api_key_id" text,
  ADD COLUMN "ip_address" text;
--> statement-breakpoint
CREATE INDEX "audit_log_organization_action_idx" ON "audit_log" ("organization_id", "action");
