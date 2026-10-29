-- Per-organization opt-in to the external AI provider (security audit C-29).
--
-- Until now one installation-wide Gemini key served every tenant, sending failure screenshots, DOM
-- and requirement text to Google without that organization's consent. The default is off: an owner
-- turns it on (PUT /api/organization/ai-policy), and every AI route refuses an organization that
-- has not.
ALTER TABLE "organizations" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;
