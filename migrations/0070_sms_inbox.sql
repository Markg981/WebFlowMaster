-- The organization's test SMS inbox (server/sms-inbox.ts): a provider (Twilio, Vonage…) posts the
-- messages its test numbers receive to /api/sms/inbound/<token>, and a waitForSms step reads them.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sms_inbound_token_hash" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sms_inbound_token_prefix" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sms_inbound_token_created_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_sms_inbound_token_hash_idx" ON "organizations" ("sms_inbound_token_hash");
--> statement-breakpoint
CREATE TABLE "sms_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "to_number" text NOT NULL,
  "from_number" text,
  "body" text NOT NULL,
  "provider" text,
  "received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sms_messages_organization_to_idx" ON "sms_messages" ("organization_id", "to_number", "received_at");
--> statement-breakpoint
ALTER TABLE "sms_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sms_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "sms_messages"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sms_messages" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "sms_messages_id_seq" TO app_user;
