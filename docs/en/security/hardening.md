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
- `EGRESS_PRIVATE_TARGETS=deny` on an installation shared by several companies, with the few
  internal addresses it must reach in `EGRESS_ALLOW_HOSTS` ([Network](#network)).
- `MFA_ISSUER` set to a name that identifies this installation.
- A body size limit on the reverse proxy no lower than the server's own: 24 MB for a test
  bundle import, 20 MB for the API tester's proxy, 12 MB for an API test import, 10 MB for an
  Excel upload (only `.xlsx`, removed once parsed; a workbook that expands past 100 MB, 2000 parts or a 100:1 ratio is refused with 413), 100 kB for every other JSON request.

## Quick start versus a shared installation {#quickstart}

`docker-compose.yml` is the local quick start, for one person on one machine. It publishes
the web process (5000), PostgreSQL (5432), Redis (6379) and Mailpit (8025, 1025) on `127.0.0.1`
only, serves plain HTTP with `SESSION_COOKIE_SECURE=false` (a Secure cookie would be dropped
without TLS and every request after sign-in would be anonymous), and Redis and Mailpit have no
password. The collaudo overlay and `docker-compose.observability.yml` are held to the same rule:
Caddy, the collaudo database on 55432, Loki and Grafana listen on the loopback.

|                          | Local quick start                        | Shared installation                                                                             |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Files                    | `docker-compose.yml` (+ local overlays)  | `deployment/releases/compose.yml`, the [network isolation profile](../admin/saas-network), Helm |
| Published ports          | `127.0.0.1` only                         | the web process only, behind your reverse proxy                                                 |
| PostgreSQL, Redis, inbox | on the loopback, development credentials | not published; Redis with a password                                                            |
| Transport                | HTTP, non-Secure cookie                  | TLS, Secure cookie                                                                              |

Do not turn the first into the second by changing `127.0.0.1` to `0.0.0.0`. `npm run
test:security` runs `scripts/security/compose-bindings.test.mjs`, which renders each local
profile with `docker compose config` (base file plus overlays, all profiles) and fails on any
port published beyond the loopback, including a second publication an overlay adds to the base
list instead of replacing it. CI runs it on every change.

## Network {#network}

For a shared SaaS, deploy the supplied [network isolation profile](../admin/saas-network).
It enforces an operator-managed exact domain/port allowlist, a mandatory proxy and guarded
API/worker namespaces. An empty allowlist denies all test destinations. The following
checks also apply to other deployments where the operator provides equivalent controls.

Where tests may connect is enforced in two layers. The proxy of the SaaS profile is the
network's: nothing leaves the workers except through it, whatever the application does. The
**egress policy** is the application's, and applies to every installation, with or without the
proxy: every address a test, a webhook, an issue tracker, a browser step or an organization's
SMTP setting makes the server connect to is checked, by name and by what the name resolves to
at the moment of connecting, on every redirect. HTTP and WebSocket connections are opened on the
vetted address itself; a gRPC channel is pinned to the vetted addresses when they are of one
family, and a name answering in both (`localhost` on many hosts) is vetted and then resolved
again by the gRPC client, like the SMTP path. Cloud metadata endpoints (`169.254.0.0/16`
including `169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`, Alibaba's
`100.100.100.200`, Oracle's `192.0.0.192`, Azure's `168.63.129.16`) are always refused. Private,
loopback, link-local and unique-local addresses are reached by default
(`EGRESS_PRIVATE_TARGETS=allow`): a self-hosted installation tests its intranet from the
server, and nothing changes for it. `EGRESS_PRIVATE_TARGETS=deny` refuses them too, which is
the setting for a shared installation; `EGRESS_ALLOW_HOSTS` exempts named hosts and CIDRs from
both. A refused request fails at once, with an error that names the policy and the host as the
test wrote it. The policy does not cover connections the server does not open itself: a local
agent's browser and requests, a browser grid's browser, and the direct TCP protocols (database
steps, the inbox a test reads through an agent's browser).

**The runner's own browsers** (the run, the builder's preview, the recorder and element
detection, which all open the same kind of session) are held to the same policy on every
channel. Each one is checked in a real browser by `server/egress-policy-browser.test.ts`:

| Channel                                                              | Where the policy is applied                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Start URL, `navigate` step, recorder/detection/preview first page    | before the browser is asked: only `http(s)` and `about:blank`; then the request guard |
| Requests of pages, popups, frames, dedicated and service workers     | request guard in the browser context (403 that names the policy)                      |
| WebSocket from a page or popup                                       | WebSocket guard in the browser context (closed with code 1008)                        |
| WebSocket or request from a worker, any connection the browser opens | the runner's guard proxy, on the address resolved at connect time                     |
| `file://`, `view-source:` and other non-web pages                    | refused when the test is saved and again when the run navigates, on every profile     |

The guard proxy runs inside the runner process and the runner's browsers are launched behind it,
loopback included. It makes every connection itself, with the same checks as the server's other
transports, so a name that resolves to a forbidden address is refused when the browser connects
(DNS rebinding). With `WFM_EGRESS_PROXY` set, the browsers go through that proxy instead, as
before, and its firewall is the authority. `file://` is refused whatever
`EGRESS_PRIVATE_TARGETS` says: the runner's disk holds its configuration and keys, and a web page
cannot open a local file by itself (browsers refuse that navigation). Private destinations an
on-premises installation needs stay reachable through `EGRESS_PRIVATE_TARGETS=allow` or
`EGRESS_ALLOW_HOSTS`, and self-signed certificates follow `allowsSelfSignedCertificate` as before.

**Agents and browser grids** run their browser on their owner's machine and network. The policy
is not applied there, and the controller does not claim to control it through its own resolver:
what such a browser may reach is decided by the network it runs in, which its owner configures.

- PostgreSQL and Redis are not reachable from the internet; only the web process and the
  workers connect to them. Redis requires a password (`redis://:password@host:6379`).
- The web process is the only public entry point. Workers need no inbound connections.
- **Decide what the workers may reach.** Tests connect wherever the workers can. On an
  installation shared by several companies, or with `REGISTRATION=open`, put the workers in a
  network segment that can reach the applications under test and the installation's own
  services, and nothing else. In particular:
  - block the cloud metadata endpoint (`169.254.169.254`) from the workers as well, or require
    token-based metadata access (for example IMDSv2 on AWS), so the network does not depend on
    the application's policy alone;
  - do not let workers reach administration interfaces of your own infrastructure;
  - let applications inside a customer's network be reached through a
    [local agent](../integrations/local-agents), not by opening routes from the workers.
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
  keys only for administration, revoked afterwards. Grant `runs:evidence` (traces and HAR files)
  only to a key that must fetch them.
- Review **Settings → API keys** for keys not used recently, and revoke them.
- Keep owners few. On an installation shared by several organizations, set
  `INSTALLATION_ADMINS` to the operators who may change log settings and drain runners
  ([Installation administrators](../admin/administration#installation-administrators)).
- Leave `CONTENT_SECURITY_POLICY` at its production default, `enforce`, and the rate limits
  (`API_RATE_LIMIT`, `WEBHOOK_RATE_LIMIT`) switched on.
- Leave `GEMINI_API_KEY` unset unless sending page content to Google is acceptable for every
  organization on the installation ([AI features](./#ai-features)).

## Data

- Database backups taken nightly, copied off the host, encrypted, and tested with a restore: `backup:verify` after every `backup:create`
  ([Backups](../admin/operations#backups)).
- Disk, database and bucket encryption at rest, as offered by your platform.
- `ARTIFACT_RETENTION_DAYS` set to what your organizations need, not more.
- Traces off, and videos at most on failure, for flows that handle real credentials or personal
  data; screenshots, videos and traces are not cleaned of secrets
  ([Raw evidence](./data-protection#raw-evidence)).
- After upgrading from a release where viewers could download traces or migrations printed
  `DATABASE_URL`: the [exposed credentials procedure](./data-protection#exposed-credentials), with
  deletion and rotation approved by the person responsible.
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
