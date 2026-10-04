# Configurable organization email implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Independent tasks use dispatching-parallel-agents.

**Goal:** Organization-controlled SMTP, native provider callbacks and editable safe transactional templates.
**Architecture:** Preserve sending/delivery boundaries; resolve trusted organization settings there. Callback UUID selects one adapter before signature verification and scoped ingestion. Owners edit settings/templates through tenant transactions.
**Tech Stack:** Express, Drizzle/PostgreSQL, Nodemailer, Node crypto, React, parser-based sanitization, Vitest and Playwright.
**Spec:** `docs/superpowers/specs/2026-10-04-email-provider-templates-design.md`; approved through PR without further intermediate approvals.

## Global constraints

- Keep installation SMTP/HMAC defaults and builder compatibility.
- Encrypt secrets with AES-GCM; never return them in GET, audit or error responses.
- Custom SMTP requires TLS and the mandatory CONNECT proxy when configured.
- Preview uses synthetic inputs, an empty iframe sandbox and restrictive CSP.
- Signed fixture tests do not establish live provider delivery.

## Review focus

- Valid signed foreign message IDs cannot alter another tenant's delivery.
- Omitted secrets retain credentials; provider changes cannot retain incompatible signing secrets.
- Worker/pre-auth reset use the actual account organization, independent of ambient context.
- Templates cannot execute browser code or lose required one-time action links.
- Concurrent edits return 409 and identity changes clear UI drafts.

### Task 1: Settings, migration, sending integration (root)

**Files:** `shared/mail-settings.ts`, `0077_organization_mail.sql`, journal/schema, `server/mail-settings.ts`, mail-settings routes/tests, `mailer.ts`, `mail-delivery.ts`, central index/routes.
**Interfaces:** `ProviderMailConfig` includes organizationId, callbackId, provider, signingSecret?, sendgridPublicKey?, sesTopicArn?. Export `resolveMailConfiguration(organizationId,env)` and callback lookup. `receiveDeliveryEvent` gains expected organization and optional recipient.

- [x] Write failing contract/route/ingestion tests; run targeted Vitest.
- [x] Add org-keyed settings and org/purpose template tables with revision/owner RLS; encrypt credentials and register migration.
- [x] Owner GET/PUT `/api/mail-settings`: version 0 creates; existing revision updates atomically; GET redacts secrets. Audit field names only.
- [x] Integrate trusted configuration, metadata headers, templates and mandatory proxy into mail sending.
- [x] Run focused settings/mailer/schema/architecture checks.

### Task 2: Provider adapters (provider worker)

**Files:** `server/mail-providers.ts`, provider routes and corresponding tests; no central/migration edits.
**Interfaces:** consume ProviderMailConfig; export providerHeaders(config,deliveryId), public router and raw-body middleware for root mounting before JSON parser. Expected organization/recipient passed to ingestion.

- [x] Add failing generated-key signed SendGrid/Mailgun/SNS fixtures.
- [x] Verify native signatures, bounded bodies, exact SNS ARN/certificate origins, no redirects and bounded certificate fetching.
- [x] Normalize outcomes and authenticate SNS subscription before constructed regional confirmation request.
- [x] Verify foreign recipient/tenant, raw bytes, duplicates, metadata and persistence failures.

### Task 3: Templates (template worker)

**Files:** `shared/mail-templates.ts`, `server/mail-templates.ts`, template routes/tests, `mail-messages.ts` context only, EmailTemplatesCard and tests; no package/migration edits.
**Interfaces:** mailTemplates table: organizationId, purpose, subject, html, text, version, updatedAt. Export applyMailTemplate(message). Root adds optional templateVariables to MailMessage. GET `/api/mail-templates`, PUT `/:purpose`, POST `/:purpose/preview`, DELETE `/:purpose` with expected version; defaults/variable list returned.

- [x] Write failing renderer/route/UI tests for HTML, variables, required action URL, owner isolation, revision and iframe restrictions.
- [x] Implement fixed escaped variables/parser allowlists with sanitizer installed by root; preserve built-ins/other purpose.
- [x] Implement subject/HTML/text editor, synthetic preview/reset and identity-scoped drafts.
- [x] Run focused tests; provide translation keys to UI/docs worker.

### Task 4: Settings UI and docs (UI/docs worker)

**Files:** EmailProviderCard/tests, settings page, EmailDeliveryCard, four locale files, EN/IT admin/configuration guides and Collaudo cases; no template implementation/migration edits.
**Interfaces:** GET/PUT mail-settings modes/SMTP/provider fields, version, credential flags and callbackId. Render owner-only provider/template cards.

- [x] Write failing UI tests for conditional fields, secret retention/redaction, stale edit and identity reset.
- [x] Implement provider-specific configuration and callback instructions using existing components.
- [x] Translate new keys EN/IT/FR/DE and document tenant SMTP/provider/editor, correlation prerequisites and restrictions.
- [x] Add Collaudo cases without claiming unexecuted manual results.

### Task 5: Integration and delivery (root)

- [x] Run combined tests, real PostgreSQL owner/tenant policies and production browser editing/reload/isolation.
- [x] Run check, lint (exclude unrelated local scratch), server/client suites, application/docs builds, Collaudo and E2E. Full server run: 2106 passed, 3 skipped and three failures subsequently corrected; affected checks 47/47 and 48/48 passed. Fresh full CI remains the final gate.
- [x] Obtain independent review; fix findings and rerun affected checks.
- [ ] Commit/push, create/attach PR, verify all CI jobs and report actual state; do not merge.
