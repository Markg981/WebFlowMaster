# Production checklist

Defaults favour a quick start on one machine. Before exposing an installation to users, go through this list. The server also logs a warning at startup, once, when `NODE_ENV=production` and the egress policy is left at its default.

## Egress allowlist

Tests make the server connect to the systems under test. By default (`EGRESS_PRIVATE_TARGETS` unset, equivalent to `allow`) tests can reach loopback and private addresses of the server's network; cloud metadata endpoints are always refused. This is right for a single company testing its intranet, and wrong for anything shared.

- Set `EGRESS_PRIVATE_TARGETS=deny` and list the intranet hosts tests may reach in `EGRESS_ALLOW_HOSTS` (`*.suffix` for a subtree, CIDRs accepted).
- With `REGISTRATION=open` the server refuses to start unless it is `deny`.
- For a fully isolated deployment see [Network isolation for a shared SaaS](./saas-network).

## TLS and reverse proxy

- Terminate TLS at a reverse proxy and set `WEBFLOW_PUBLIC_URL` to the public `https://` address.
- Set `TRUST_PROXY` to the real proxy chain (hop count, `false` when none, or proxy IPs/CIDRs), otherwise client IPs and per-IP rate limits can be forged.
- Do not use `INSECURE_TLS_HOSTS` in production.

## Secrets

- Generate your own `SESSION_SECRET`, `ENCRYPTION_KEY` (`openssl rand -hex 32`) and `AGENT_RELAY_SECRET`; the placeholders in `.env.example` stop a production start.
- Keep them out of the repository and plan rotation: [Rotating the encryption key](./operations#rotating-the-encryption-key).

## Backups

Schedule the backup tool and rehearse a restore: [Backups](./operations) and the full application recovery drill.

## Retention

Set `ARTIFACT_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `EVIDENCE_RETENTION_DAYS` and `LOG_RETENTION_DAYS` to what your policy requires: [Configuration reference](./configuration).

## Single sign-on

Configure SSO per organization and keep `SSO_REQUIRE_DOMAIN_VERIFICATION` on: [Administration](./administration). Define `INSTALLATION_ADMINS` and know how to [recover access](./operations#recovering-access).

## Required variables

`DATABASE_URL` (PostgreSQL), `REDIS_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `NODE_ENV=production`, `WEBFLOW_PUBLIC_URL`. Full list: [Configuration reference](./configuration). See also [Security hardening](../security/hardening).
