# Administration configuration

Continue administration work on the current branch, preserving existing local changes. The active scope is advanced SAML configuration and installation email administration. Billing is deferred by the user's explicit decision.

## Active tasks

- [x] Extend organization SAML settings with optional identity provider initiated sign-in, required encrypted assertions, matching service provider RSA certificate/private key, and single logout.
- [x] Preserve signature, issuer, audience, expiry, domain and replay checks. Keep unsolicited sign-in disabled by default and explain the browser login risk when enabling it.
- [x] Keep the service provider private key encrypted on the server. Settings responses expose only whether a key is configured; a blank input retains it, and an explicit removal clears key and certificate.
- [x] Extend the owner-only SSO settings card with the advanced fields, metadata import of the identity provider logout endpoint, and the service provider logout callback address.
- [x] Extend built-in email templates with HTML and text, record delivery history, and accept authenticated signed bounce callbacks. Suppress delivery to hard-bounced addresses.
- [x] Expose organization-scoped delivery history to tenant owners. Keep the existing installation SMTP environment configuration.
- [x] Integrate migrations, English and Italian strings, documentation, and meaningful API/component/security regressions. Run type checks and relevant broader suites.

## Deferred billing decision

Billing, payments, subscriptions and billable usage implementation are suspended at the user's request. No billing provider, price list, currency, catalog or charging policy has been selected. Resume only after a new user instruction defines that scope. Existing execution quotas remain unchanged; there are no new usage counters, payment integrations, billing migrations or execution lifecycle hooks in this task.

## Coordination

- Backend SAML settings, validation, signing/decryption and logout: SAML backend agent.
- SSO settings UI and component tests: dashboard/UI agent.
- Email templates, delivery persistence and signed bounce handling: email backend agent.
- Email administration UI, shared schema and migration registration, locales, final documentation and verification: root agent.
- Preserve all pre-existing work. Do not commit, push, apply live database migrations, or make purchases.

## Progress

- Existing SSO UI and settings routes inspected. Advanced SAML API contract agreed between backend and UI agents.
- Billing exploration performed read-only. No billing files were created or changed.
- Migrations 0073/0074 registered and applied only to per-suite PGlite databases. Schema inventory verified: 69 tables, 52 RLS tables, 80 same-organization constraints.
- Independent review found and regressions fixed: nested encryption-marker bypass, unbounded pre-signature SLO decompression, authenticated bounce following ambiguous SMTP timeout, and WebSocket access after SAML registry revocation.
- Signed XML fixtures exercise encrypted assertions and SP/IdP initiated SLO (Redirect and POST), correlation, replay, invalid signatures/destinations/session identities and cross-tenant session references.
- Targeted final SAML/socket checks: 33 passing. Final full server suite: 1,985 passing, zero failures, one skipped. Full client suite: 442 passing. Typecheck, scoped lint, production build, documentation build and diff check passed.
- SMTP provider webhooks require an adapter to the documented normalized HMAC event contract. No provider interoperability or live SMTP/IdP test was performed.
