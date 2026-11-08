-- B-02: SCIM bearer tokens expire. Null = issued before this migration (non-expiring until reissued).
ALTER TABLE "organization_sso" ADD COLUMN IF NOT EXISTS "scim_token_expires_at" timestamp;
