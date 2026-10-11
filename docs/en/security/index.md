# Security overview

How WebFlowMaster protects the data of the organizations that use it: what the product does
itself, what it leaves to whoever runs the installation, and where its limits are today. Written
for security reviewers and for the operators who answer their questions.

The technical detail behind each section is in [Tenancy and access](../internals/tenancy); the
settings named here are in the [configuration reference](../admin/configuration).

To report a vulnerability, follow the
[security policy](https://github.com/Markg981/WebFlowMaster/security/policy): privately, through
GitHub, never in a public issue.

## Shared responsibility

| Area | The product | The operator of the installation | The organization's owners |
|---|---|---|---|
| Isolation between organizations | Enforced by the database on every query | Runs PostgreSQL with the required roles | — |
| Accounts and access | Roles, two-factor, API key scopes, invitation-only registration, audit trail | Network exposure, the `REGISTRATION` setting | Members, roles, requiring two-factor, key hygiene |
| Secrets stored for tests | Encrypted with AES-256-GCM, never returned | Keeps `ENCRYPTION_KEY` safe and backed up | Decides which secrets to store |
| Data in transit | Secure cookies, origin checks | TLS in front of the web process, between services | — |
| Data at rest | Application-level encryption of secrets | Disk, database, backup and bucket encryption | — |
| Where tests may connect | Nothing is blocked: reaching the application is the job | Network rules for the workers | What their tests call |
| Updates | Releases with migrations | Applying them, patching hosts | — |

## Isolation between organizations

Organizations share one database. Isolation does not depend on every query remembering a filter:
PostgreSQL **row-level security** is enabled and forced on every table that belongs to an
organization, and every request runs its queries as a database role that cannot bypass it, bound
to the requester's organization. A query that forgot its filter returns nothing from another
organization; it does not return everything.

- The web process refuses to start if the database roles would make this ineffective.
- The few operations that must cross organizations (sign-in, token lookups, installation-wide
  tables, erasure) use a separate, privileged connection. An automated test lists every file
  allowed to use it, with a reason, so a new use is a reviewed decision.
- Isolation tests run in the test suite on every change.
- Within an organization, **restricted projects** narrow who sees a project's tests, also
  enforced by the database.
- Live logs over WebSocket check the session and that the run belongs to the viewer's
  organization, in the same way.

## Identity and access

**People** sign in with a username and password. Accounts are created by **invitation** by
default: an owner invites from **Settings → Members**, and registering without an invitation is
refused, except for the installation's very first account. `REGISTRATION=open` allows public
sign-up, where each new account gets an organization of its own.

- Passwords are hashed with scrypt and a per-user random salt; the hash never leaves the
  database in an API answer. Passwords must be 8 to 128 characters.
- Sign-in, registration and second-factor endpoints are limited to 20 attempts per client
  address every 15 minutes. Failed sign-ins for existing accounts are recorded in the audit log.
- **Two-factor authentication**: TOTP codes from an authenticator app (RFC 6238), each accepted
  once, plus one-time recovery codes stored as hashes. After the password, the session is not
  signed in until the code is given: five wrong codes or five minutes end the attempt. Owners can
  require two-factor for the whole organization, which applies to sessions already open.
- **Sessions** are server-side (Redis), for 7 days. The cookie is `HttpOnly`, `SameSite=Lax` and
  `Secure` in production. Signing in issues a new session id.
- **Changing a password** needs the current one and a signed-in session, not an API key. A
  forgotten password is recovered with a one-time link an owner issues (or, for an organization's
  only owner, the operator), valid for a day and stored only as a hash. A session carries a stamp
  of the password it was opened with, so a new password ends every other session of that person.
- **Single sign-on** with OpenID Connect or SAML 2.0, per organization
  ([Administration](../admin/administration#single-sign-on)): authorization code flow with PKCE,
  a one-time state and nonce, and the ID token's signature, issuer, audience and expiry checked
  against the provider's published keys. With SAML, the assertion's XML signature is checked
  against the certificate the owner saved, along with its issuer, audience (the organization's own
  entity ID) and validity window; it must answer an AuthnRequest this installation sent, and that
  request is consumed atomically in the database, so a response cannot be replayed — not even on
  another web server — and an unsolicited one is refused. With Secure cookies a short-lived
  cookie binds the request to the browser that started it, against login CSRF. Metadata pasted by
  an owner is parsed without DTDs. Accounts are matched by the provider's stable subject,
  not by e-mail address; new ones get viewer or editor, never owner. The client secret is
  encrypted like other stored secrets. An owner can **require** it: members' passwords then stop
  working, including in open sessions, while owners keep theirs as a way back in.
- **Roles**: viewer, editor, owner, checked on every endpoint. See
  [Administration](../admin/administration#roles).

**Machines** never use a person's password:

| Credential | Stored as | Scope | Lifetime |
|---|---|---|---|
| API key | SHA-256 hash, shown once | Its account's role; optionally narrowed to named scopes on `/api/v1` | Until revoked or its expiry date |
| Service account | An account that cannot sign in | Viewer or editor | Until disabled, which revokes its keys |
| Webhook token | SHA-256 hash, shown once | Starts one plan | Until deleted |
| Local agent token | SHA-256 hash, shown once | One agent of one organization | Until revoked |
| Relay ticket | Not stored; HMAC-signed | One organization, pool and browser | 60 seconds |

Tokens are 32 random bytes; a single hash is enough for values that cannot be guessed, and makes
the lookup exact.

## Protecting stored secrets

What the product must present to other systems on a customer's behalf is **encrypted** with
AES-256-GCM, each value with its own IV and authentication tag, using the installation's
`ENCRYPTION_KEY`:

- environment secrets used by tests (passwords, tokens, the addresses of the systems under test);
- issue tracker, GitHub and GitLab tokens;
- saved login states (the cookies of the application under test);
- second-factor secrets.

None of these is ever returned by the API: forms that edit them treat an empty field as "leave
unchanged". Tests store <code v-pre>{{secret_…}}</code> placeholders, including passwords typed
while recording, and the value is resolved only when a step needs it.

## Application hardening

- **CSRF**: requests that change data must come from the application's own origin (or one listed
  in `CSRF_TRUSTED_ORIGINS`); machine requests without a browser origin authenticate with a key
  or token instead of a cookie.
- **HTTP headers**: Helmet's defaults (HSTS, `X-Content-Type-Options`, frame protection and
  others) and, in production, a **Content Security Policy**: scripts, connections and workers
  only from the application's own origin (no inline or evaluated script), no plugins, no framing
  by other sites. Styles may be inline, which the interface components need, and fonts come from
  Google Fonts. The code editor and every other script are served by the installation itself;
  nothing is loaded from a CDN. `CONTENT_SECURITY_POLICY` can switch it to report-only or off.
- **Request rates**: sign-in is limited per address; each API key, and each address calling the
  public API without a key, is limited to `API_RATE_LIMIT` requests a minute (600 by default);
  webhooks to `WEBHOOK_RATE_LIMIT` per address (120). Past it the answer is `429` with
  `Retry-After`.
- **Installation-wide settings** (log level, log retention, draining runners) are changed only by
  the people named in `INSTALLATION_ADMINS`, or by an owner while the installation has a single
  organization. The owners of other organizations see them read-only.
- **Input validation**: request bodies are validated with schemas before they reach the
  database; queries are parameterized through the ORM.
- **Request size**: JSON bodies are limited to 100 KB.
- **Errors**: an unexpected error answers with its message and no stack trace; the stack goes to
  the log. Every response carries an `X-Correlation-Id` header that finds the matching log lines.

## Logging and audit

**Audit log.** Changes to members, keys, tests, plans, schedules, projects, environments and
secrets, reviews, agents, integrations, runners, security settings, and sign-ins are recorded
with the actor, the action, the target, the client's IP address and, for API calls, which key.
Entries are written in the same transaction as the change. The application's database role can
only read and add to the log, never change or delete it. Owners can filter and export it.

**Application logs** are structured JSON with a correlation id per request. Passwords, tokens,
keys and similar fields are masked before a line is written. Logs are kept 7 days by default and
can be shipped to Grafana Loki.

## Evidence from test runs

Runs keep screenshots, videos, Playwright traces and network captures (HAR) according to each
plan's settings. They show what the browser showed, which can include personal data of the
application under test and values typed into forms.

- Network captures are cleaned before they are stored: authentication headers and cookies are
  removed, credentials in URLs are cleared, and request and response bodies are never recorded.
- Evidence is served only to members of the organization that owns the run.
- It is removed after `ARTIFACT_RETENTION_DAYS` (90 by default); results and verdicts remain.

## Outbound connections

Tests exist to reach other systems, so **the product does not restrict where a test connects**:
a browser step or an API test can address any host the worker can reach. Certificate checks are
always on in production; development exemptions are per host and ignored in production.

This makes the workers' network position a security decision. See
[Hardening](./hardening#network) for the rules an operator should apply, in particular on an
installation where people from different companies can write tests.

**Test inboxes.** A **Wait for email** step reads a Mailpit, which by design holds the mail of
every address sent to it and has no notion of an owner. The step returns only mail to the exact
address it names, received since its test started, but anyone who can reach the inbox can read
all of it. Name the inbox per environment (the `mailpit.url` secret, with `mailpit.username` and
`mailpit.password` when it is protected) and leave the server-wide `MAILPIT_URL` unset on an
installation shared by several companies. Test inboxes are for test mail: never point real users'
mail at one.

**Test databases.** A **Query database** step runs whatever SQL its test holds, with the rights of
the user in the environment's `db.url`, from the runner's network. Anyone who can edit tests in
the organization can therefore read and change what that user can: give it the least it needs, on
a test database, and keep `db.url` a secret (its password is then encrypted and never shown). The
password never appears in a step's error. Since the connection is made by the runner, the
[network rules](./hardening#network) for workers apply to databases as to any other address.

**Authenticator seeds.** <code v-pre>{{$totp(name)}}</code> reads the seed from the variable named, so
keep it a secret of the environment; the code it makes is valid for about 30 seconds.

## Local agents

A local agent lets a customer test applications inside their own network without opening it to
the installation:

- the agent only makes **outbound** connections to the installation; nothing connects into the
  customer's network;
- it lends browsers, not the network: runs drive the browser the agent started, and only the
  organization that created the agent can use it;
- a runner needs a ticket signed with a secret shared by the installation's processes, valid for
  one minute and one organization;
- revoking the agent's token disconnects it immediately.

## AI features

AI features are **off unless the operator sets a Google Gemini API key**. When they are on, the
following leaves the installation for Google's API:

| Feature | What is sent |
|---|---|
| Describing a test in sentences | The sentences, the list of allowed actions, and the names and labels of the elements available (never selectors or secrets). |
| Selector healing, when a step cannot find its element | The failing selector, the error, and up to 30,000 characters of the page's HTML. |
| Tests from a story, when an editor asks for them | The requirement's key and title, and its description and acceptance criteria as the tracker has them (up to 12,000 characters). |
| Failure analysis, when an editor asks for it on a failed result | The test's name, the runner's reason, the steps around the failure with their selectors, errors and values (values that look like passwords, codes or keys are replaced by `[hidden]`), the failed and slowest requests, and the screenshot of the failure. |

Page HTML can contain personal data of the application under test. Enable the key only where
sending it to Google is acceptable; everything else works without it.

## Vulnerability management

- Dependencies are reviewed with `npm audit`, and findings with their decision are recorded in
  `docs/SECURITY-AUDIT.md` in the repository.
- The test suite (more than 1,600 tests) runs on every change, including isolation tests between
  organizations, architecture tests that limit privileged database access, and tests of the
  authentication and audit paths.
- Playwright and the browsers are pinned to one version across the web image, the worker image
  and the agent.

## Known limitations

Stated so a review can weigh them, not discovered later:

- **Single sign-on** without SCIM applies roles from the provider's groups, and the refusal of
  people in none of them, at sign-in, so an open session keeps its role until the next one; with
  SCIM provisioning, deactivation and group changes apply at once, and the SCIM token, held by the
  provider, can create, deactivate and remove the organization's members (never its last active
  owner). SAML requires signed assertions and supports encrypted assertions with a configured
  service-provider RSA key pair, optional IdP-initiated sign-in and signed single logout.
  IdP-initiated sign-in is disabled by default and lacks request/browser binding; single logout
  requires a provider logout URL and compatible bindings and signatures. See
  [advanced SAML configuration](../admin/administration.md#single-sign-on) before enabling these options.
  Without a required group, a person removed here but not at the provider gets
  a new account at their next sign-in, so access is ended at the provider. E-mail domains are
  proven by a DNS TXT record; proof is required only with `SSO_REQUIRE_DOMAIN_VERIFICATION=true`,
  and without it, on a shared installation, the first organization to claim a domain has it.
- **Password complexity is opt-in**: the default policy checks length only; `PASSWORD_POLICY=strong`
  adds length 12, character mix, no username and no common passwords. Without SMTP, invitation and
  reset links are handed over by the owner.
- **Rate limits fall back to per-process counting** while Redis does not answer: the counts
  (sign-in, API keys, webhooks, SSO, SCIM, log ingestion) are kept in Redis and shared by every web
  process, but a request is never held waiting for Redis, so during an outage each process counts
  on its own until it is back.
- **Styles may be inline** under the Content Security Policy, which the interface components
  require.
