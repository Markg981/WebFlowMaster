# Hardening checklist

What the operator of an installation should do before, and after, it is reachable by other
people. Each item names the setting or the page that explains it. The
[security overview](./) explains why each one matters.

## Before going live

- `NODE_ENV=production` on every process.
- Fresh, random `SESSION_SECRET` and `ENCRYPTION_KEY`; none of the values from
  `docker-compose.yml` or `.env.example` ([Secrets](../admin/installation#secrets)).
- `ENCRYPTION_KEY` stored in a secret manager and backed up apart from the database.
- If local agents are used, a separate `AGENT_RELAY_SECRET`, the same on every process.
- PostgreSQL 15+ with the roles the server checks: the connecting role holds `BYPASSRLS`,
  `app_user` does not ([Prepare PostgreSQL](../admin/installation#prepare-postgresql)).
- Database initialized with `db:migrate`, never `db:push`; `npm run db:doctor` reports no
  action needed.
- TLS in front of the web process; `SESSION_COOKIE_SECURE` not set to `false`.
- Exactly one reverse proxy in front, so recorded client addresses are real
  ([Behind a reverse proxy](../admin/installation#behind-a-reverse-proxy)).
- `CSRF_TRUSTED_ORIGINS` lists only your own public origins, if it is set at all.
- `INSECURE_TLS_HOSTS` unset (it is ignored in production anyway).
- `MFA_ISSUER` set to a name that identifies this installation.

## Network {#network}

- PostgreSQL and Redis are not reachable from the internet; only the web process and the
  workers connect to them. Redis requires a password (`redis://:password@host:6379`).
- The web process is the only public entry point. Workers need no inbound connections.
- **Decide what the workers may reach.** Tests connect wherever the workers can. On an
  installation shared by several companies, or with `REGISTRATION=open`, put the workers in a
  network segment that can reach the applications under test and the installation's own
  services, and nothing else. In particular:
  - block the cloud metadata endpoint (`169.254.169.254`) from the workers, or require
    token-based metadata access (for example IMDSv2 on AWS);
  - do not let workers reach administration interfaces of your own infrastructure;
  - let applications inside a customer's network be reached through a
    [local agent](../LOCAL_AGENT), not by opening routes from the workers.
- Workers on other machines use `ARTIFACT_STORE=s3`, and the bucket is private.

## Access

- Register the installation's first account yourself, before it is reachable by others: until
  it exists, whoever registers first owns the first organization.
- Keep `REGISTRATION` at its default, `invitation`, unless the installation offers public
  sign-up; invite people from **Settings → Members**.
- Require two-factor authentication in each organization (**Settings → Security**).
- Where an organization has an identity provider, set up
  [single sign-on](../admin/administration#single-sign-on), require it, and require the second
  factor at the provider. Set `WEBFLOW_PUBLIC_URL`, so the redirect URI does not depend on the
  request's `Host` header.
- Pipelines use **scoped** API keys on **service accounts**, with an expiry date; full-access
  keys only for administration, revoked afterwards.
- Review **Settings → API keys** for keys not used recently, and revoke them.
- Keep owners few. On an installation shared by several organizations, set
  `INSTALLATION_ADMINS` to the operators who may change log settings and drain runners
  ([Installation administrators](../admin/administration#installation-administrators)).
- Leave `CONTENT_SECURITY_POLICY` at its production default, `enforce`, and the rate limits
  (`API_RATE_LIMIT`, `WEBHOOK_RATE_LIMIT`) switched on.
- Leave `GEMINI_API_KEY` unset unless sending page content to Google is acceptable for every
  organization on the installation ([AI features](./#ai-features)).

## Data

- Database backups encrypted and tested with a restore
  ([Backups](../admin/operations#backups)).
- Disk, database and bucket encryption at rest, as offered by your platform.
- `ARTIFACT_RETENTION_DAYS` set to what your organizations need, not more.
- Log retention in **Settings → System** set deliberately; logs shipped to a central store
  (`LOKI_URL` or your platform's collector) if they must outlive the machine.
- A procedure for completing an organization's erasure: files in the artifact store, and
  backups ([Data protection](./data-protection#what-erasure-does-and-does-not-reach)).

## Running

- Upgrades applied promptly, with the runners drained first
  ([Upgrading](../admin/operations#upgrading)).
- Host operating systems and container base images patched.
- `npm audit` reviewed on each upgrade, with decisions recorded in `docs/SECURITY-AUDIT.md`.
- The audit log reviewed by each organization's owners, in particular failed sign-ins,
  new API keys, new owners and changes to security settings.
- Alerts on the web process health check and on runners going offline
  ([Monitoring](../admin/operations#monitoring)).
