-- E-mail about the runs a person starts (server/mailer.ts). Off by default: nobody starts
-- receiving mail because the operator configured SMTP.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "notify_by_email" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "notify_run_completed" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "notify_run_failed" boolean DEFAULT true NOT NULL;
