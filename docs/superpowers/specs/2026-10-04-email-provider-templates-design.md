# Organization-configurable email providers and templates

Branch: `codex/email-provider-templates`, based on merged main `3e319ab` (PR #291). Design prepared for review on 2026-10-04.

## Outcome and scope

Each organization chooses its own SMTP sender and delivery tracking provider. No installation-wide choice forces every tenant to use the same provider. Ship native adapters for Amazon SES/SNS, SendGrid and Mailgun, alongside generic signed events for other providers and plain SMTP without confirmed tracking. Owners edit invitation, password-reset and run-notification templates in Settings. The same organization-configuration principle applies to future integrations; this change does not rewrite unrelated integrations.

Keep existing SMTP environment settings, built-in templates and `/api/mail-deliveries/events` working. SMTP acceptance remains distinct from confirmed delivery. Owners can still hand over invitation/reset links if sending is disabled or fails. A delivery failure never changes a run result.

## Organization settings

Add one `organization_mail_settings` row per organization with a revision, timestamps, SMTP mode (`inherit`, `custom`, `disabled`), provider (`none`, `generic`, `ses`, `sendgrid`, `mailgun`), an opaque callback UUID, sender and provider options. Missing settings inherit the existing installation configuration. Custom settings supply SMTP host, port, username, password and implicit TLS/STARTTLS selection; do not accept arbitrary Nodemailer options or tenant-controlled certificate-validation bypasses. Require TLS for custom SMTP.

Encrypt SMTP passwords and webhook signing secrets with the existing AES-GCM helper and `ENCRYPTION_KEY`. Read responses return configuration and credential-presence flags, never passwords or signing secrets. Omitted secrets on edit preserve existing values; explicit replacement/clear controls avoid accidental credential loss. Validate provider-specific fields and refuse incomplete active settings. Updating with a stale revision returns 409. Configuration mutations and template edits produce atomic audit entries containing field names, not content or credentials.

Only organization owners can read or change these settings. SQL policies enforce tenant isolation and owner write access. Worker and pre-authentication account-reset sending resolve configuration using the message's trusted organization ID, never request-supplied tenant data. Anonymous/system mail without an organization continues to use installation defaults. A configured tenant send failure must not fall back to another tenant or the installation sender.

Custom SMTP uses bounded connections, sanitized error messages and file/URL attachment access disabled. When `WFM_EGRESS_PROXY` is set, SMTP goes through its mandatory HTTP CONNECT route; no direct fallback. The deployment's destination/domain/port allowlist continues to control reachable SMTP services. Configure infrastructure authorization separately from application settings; this feature does not weaken the default denial of private/metadata destinations.

## Provider adapters and callback isolation

Expose `/api/mail-deliveries/providers/:callbackId` before session authorization. An opaque UUID selects exactly one organization's saved adapter. Possessing that URL is insufficient: each request must pass that adapter's native verification. Keep provider input bodies bounded and retain raw bytes where required. Reject disabled/unconfigured adapters and unsupported input shapes without recording events.

- **SendGrid:** verify the native ECDSA signature over timestamp plus raw body using the configured public verification key. Add `wfm_delivery_id` through SMTP `X-SMTPAPI` unique arguments. Normalize delivered, deferred and bounce events using provider event IDs.
- **Mailgun:** verify HMAC-SHA256 of the native timestamp and token using the webhook signing key. Add `wfm_delivery_id` through `X-Mailgun-Variables`. Normalize delivered and temporary/permanent failed events using native event IDs.
- **Amazon SES/SNS:** require an exact configured SNS topic ARN, verify SNS signatures with strictly allowlisted regional HTTPS certificate endpoints, bounded fetching and no redirects. Support signed subscription confirmation without an external adapter, using a constructed regional SNS confirmation request after verification. Correlate via original `X-Wfm-Delivery-Id` headers (enable original headers in SES notifications); normalize Delivery and transient/permanent Bounce notifications. Document this provider prerequisite explicitly.
- **Generic:** accept the existing normalized event contract and HMAC headers with an organization-specific signing secret. The installation endpoint remains compatible with its existing environment secret.

Reuse delivery-event persistence, deduplication, permanent-bounce precedence and organization-scoped suppression. Extend ingestion with an explicit expected organization; provider callbacks must never mutate a foreign message even when providers share credentials or a valid foreign UUID is supplied. Check recipient correlation when present in native events. Unknown or irrelevant authentic events are acknowledged without retaining their payloads; retryable persistence failures return errors. Malformed supported events must not produce partial success claims.

Store no raw provider payloads, SMTP errors, message bodies or account tokens in delivery history. Certificate fetching cannot contact user-supplied hosts. Provider rotation is explicit: a new callback UUID invalidates the old endpoint; warn about outstanding callbacks before rotation. Ordinary same-provider configuration edits preserve the callback URL.

## Template editor

Add organization-scoped overrides for the three existing purposes in `organization_mail_templates`. Owners edit subject, HTML source and plain-text alternative, see supported variables, request a preview with synthetic data and reset to the built-in template. The editor includes save state and revision conflicts; switching organization or purpose clears drafts and previews.

Use a small fixed variable language (`{{variable}}`), with no executable expressions, arbitrary object access or unescaped insertion. Allow only purpose-specific variables supplied by the application. Preserve a usable invitation/reset action URL in HTML and plain text; validate required variables before save and render. Do not allow subject CR/LF injection. Bound template size and interpolation work.

Sanitize HTML on the server using an established parser-based sanitizer with explicit element, attribute, URL-scheme and inline-style allowlists. Remove script, forms, embeds, event handlers and unsafe CSS/URLs. Escape dynamic values before HTML interpolation; validate application action URLs. Send the same safe render used for the preview. Preview is an iframe with an empty sandbox and restrictive CSP, synthetic links/tokens, scripts and outbound resource loading disabled. No preview sends mail or uses live invitation/reset tokens.

Resolve template overrides in the shared sending boundary so invitation, owner reset, forgotten-password and worker run-notification paths behave consistently. Built-in message builder functions remain compatible. Missing overrides preserve current subject/HTML/text behavior; purpose `other` remains unchanged. If a stored override cannot safely render, use the built-in message and report the condition without exposing content or tokens.

## API and UI integration

Owner settings endpoints provide read/update configuration, template list/read/save/reset and preview. Derive organization and actor from the authenticated tenant context. Return 401/403 for unauthorized callers, 400 for invalid input and 409 for stale revisions. Public callbacks never accept a browser session as authorization.

Settings → Security → Email contains sender mode and provider selector, the relevant provider fields, write-only credential controls, the callback URL/instructions, template editor and existing delivery history. Track configured sending/tracking for the active organization rather than only environment settings. Keep identity in query keys and clear state on identity changes. Add EN/IT/FR/DE interface copy and EN/IT administration/configuration guides.

## Verification and delivery

Use regression tests before implementations for organization settings, credential retention/redaction, callback signatures/raw bytes, forged/cross-tenant events, duplicate and delayed events, suppression, HTML/variable/URL sanitization, preview isolation, stale edits and all sending call sites. Verify SMTP metadata and proxy routing with controlled fixtures. Test actual additive migration and non-superuser PostgreSQL RLS, plus authenticated browser editing/reloading and a second organization proving isolation.

Add reproducible Collaudo cases and local evidence without marking unexecuted manual cases passed. Run typecheck, lint, server/client suites, application/docs builds, Collaudo and real-installation E2E. Review the final diff, push and create a PR; no automatic merge. Provider protocol tests use signed fixtures; an actual external provider delivery requires that organization's account and credentials and must not be claimed from fixture tests.

## Primary protocol references

- SendGrid signature verification: https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
- SendGrid SMTP unique arguments: https://www.twilio.com/docs/sendgrid/for-developers/sending-email/unique-arguments
- Mailgun signatures: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
- SES notification contents: https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html
- SNS signature verification: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
- SMTP proxy routing: https://nodemailer.com/smtp/proxies
