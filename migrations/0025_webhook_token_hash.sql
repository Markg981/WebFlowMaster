-- A webhook's token, kept as a hash.
--
-- The token was stored as it was, and it is all a caller needs to start the plan: anyone who
-- could read this table — a backup, a replica, a support session with a SQL prompt — could run
-- every plan that had a webhook. API keys have been kept as SHA-256 since they existed; this
-- does the same for webhooks.
--
-- Existing webhooks keep working: the hash of the token a pipeline already has is computed
-- here, and a request is matched against it. The token itself is then dropped, so nothing that
-- reads this table afterwards can recover it.
ALTER TABLE "test_plan_webhooks"
  ADD COLUMN "token_hash" text,
  ADD COLUMN "token_prefix" text;
--> statement-breakpoint
UPDATE "test_plan_webhooks"
  SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'),
      "token_prefix" = left("token", 12);
--> statement-breakpoint
ALTER TABLE "test_plan_webhooks"
  ALTER COLUMN "token_hash" SET NOT NULL,
  ALTER COLUMN "token_prefix" SET NOT NULL,
  ADD CONSTRAINT "test_plan_webhooks_token_hash_unique" UNIQUE ("token_hash");
--> statement-breakpoint
ALTER TABLE "test_plan_webhooks" DROP COLUMN "token";
