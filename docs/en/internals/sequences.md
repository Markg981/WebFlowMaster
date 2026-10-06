# Sequence diagrams

The main flows of the system as interactions between the processes and stores described in
[System architecture](./system-architecture). Each diagram is followed by the points that are easy to
get wrong. The prose version of the run flow, with every edge case, is [Run lifecycle](./execution).

## 1. Sign-in with a password and a second factor

```mermaid
sequenceDiagram
  actor U as Person
  participant B as Browser
  participant W as Web process
  participant R as Redis
  participant DB as PostgreSQL
  U->>B: username and password
  B->>W: POST /api/login
  W->>DB: find user, compare scrypt hash
  alt organization requires SSO
    W-->>B: refused, use single sign-on
  else password ok and MFA enabled
    W->>R: session {pending second factor}
    W-->>B: 200, second factor required
    U->>B: TOTP code or recovery code
    B->>W: POST /api/login/mfa
    W->>DB: check code, reject replayed step
    W->>R: session {authenticated}
    W-->>B: 200, session cookie
  else password ok, no MFA
    W->>R: session {authenticated}
    W-->>B: 200, session cookie
  end
  Note over W,DB: every later request: tenancy middleware binds the organization and SET ROLE app_user
```

- The login is rate limited per address (`AUTH_RATE_LIMIT`, 20 per 15 minutes by default).
- A TOTP step is accepted once (`last_used_step`), so a copied code cannot be replayed.

## 2. Single sign-on

```mermaid
sequenceDiagram
  actor U as Person
  participant B as Browser
  participant W as Web process
  participant DB as PostgreSQL
  participant IDP as Identity provider
  U->>B: e-mail address
  B->>W: GET /api/sso/start?email=…
  W->>DB: sso_domains, organization_sso
  alt OpenID Connect
    W-->>B: redirect to the provider (PKCE, state)
    B->>IDP: authorize
    IDP-->>B: redirect with code
    B->>W: GET /api/sso/callback
    W->>IDP: exchange code, read ID token and claims
  else SAML 2.0
    W->>DB: insert sso_saml_requests (AuthnRequest id)
    W-->>B: redirect with AuthnRequest (+ binding cookie)
    B->>IDP: sign in
    IDP-->>B: auto-submitting form
    B->>W: POST /api/sso/saml/{org}/acs (signed assertion)
    W->>DB: delete sso_saml_requests by InResponseTo (once)
  end
  W->>DB: sso_identities by issuer + subject
  alt known identity
    W->>DB: update last sign-in
  else first sign-in, e-mail verified and in an allowed domain
    W->>DB: create or link user with the default role
  else not verified or domain not allowed
    W-->>B: refused, in words
  end
  W-->>B: session cookie
```

## 3. A request from the browser, under row-level security

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Web process
  participant DB as PostgreSQL
  B->>W: GET /api/test-plans
  W->>W: session gives user, user gives organization
  W->>W: requireRole viewer
  W->>DB: BEGIN
  W->>DB: SET LOCAL ROLE app_user
  W->>DB: SET LOCAL app.current_org = 42
  W->>DB: SELECT * FROM test_plans
  DB-->>W: only organization 42's rows (policy)
  W->>DB: COMMIT
  W-->>B: 200 JSON
```

The `WHERE organization_id = 42` is _not_ in the query. The policy adds it, so a forgotten filter
cannot leak another organization's rows.

## 4. A plan runs

```mermaid
sequenceDiagram
  actor U as Person or pipeline
  participant W as Web process
  participant O as Orchestrator
  participant DB as PostgreSQL
  participant Q as Redis BullMQ
  participant K as Worker
  participant S as Artifact store
  participant X as Trackers, SCM, notifiers
  U->>W: Run (button, schedule, /api/v1, webhook)
  W->>O: enqueue(plan, trigger, idempotency key, CI context)
  O->>DB: idempotency key already used?
  O->>DB: queue limit of the organization
  O->>O: build snapshot, resolve suites and published versions
  O->>DB: INSERT run as queued
  O->>Q: add job, job id = run id
  O-->>W: run
  W-->>U: 201 {runId}
  Q->>K: job
  K->>DB: conditional update queued to running (take the run)
  loop every test on every browser
    K->>K: run steps with policies, retries
    K->>S: screenshots, video, trace, HAR
    K->>DB: result row, execution_logs
    K-->>W: live log over Redis and WebSocket
  end
  K->>DB: verdict, exactly one terminal state
  K->>X: notifications, issues, commit status, test-management publication
  W-->>U: report page and /api/v1/runs/{id}
```

- **Exactly one terminal state:** every state change is a conditional `UPDATE … WHERE status = …`;
  a late or duplicate writer changes nothing.
- **Side effects never decide the verdict:** the last arrow can fail and the run stays `completed` or
  `failed`.
- A worker that dies is found by the recovery sweep (heartbeat older than `RUN_STALE_AFTER_MS`).

## 5. A pipeline runs a plan (CLI)

```mermaid
sequenceDiagram
  participant CI as CI job
  participant C as wfm CLI
  participant W as Web process
  participant K as Worker
  CI->>C: wfm run plan --wait --junit out.xml
  C->>C: read repository, commit, branch, build URL from the CI environment
  C->>W: POST /api/v1/plans/{id}/runs (Bearer key, Idempotency-Key, ciContext)
  W-->>C: 201 runId
  W->>K: queue
  loop until finished
    C->>W: GET /api/v1/runs/{id}
    W-->>C: status
  end
  C->>W: GET /api/v1/runs/{id}/junit and /export/{format}
  C-->>CI: files, exit code 0 passed, 1 failed, 2 could not run
```

## 6. A browser borrowed from a local agent

The detailed protocol is in [Local agents (internals)](./agents).

```mermaid
sequenceDiagram
  participant A as Local agent
  participant RL as Relay in the web process
  participant K as Worker
  A->>RL: WSS connect, Bearer wfa_ token
  A->>RL: hello {protocol, Playwright version, browsers, maxSessions}
  K->>RL: GET availability?ticket (HMAC, 60 s)
  RL-->>K: available, or the reason in words
  K->>RL: WSS browser?ticket (Playwright connect)
  RL->>RL: choose agent: same pool, same Playwright major.minor, engine, not draining, least busy
  RL->>A: open {sessionId, engine, headless}
  A->>A: launchServer
  A->>RL: WSS session/{sessionId}
  RL-->>K: Playwright protocol copied both ways
```

## 7. A mobile test on a device

```mermaid
sequenceDiagram
  participant K as Worker
  participant DB as PostgreSQL
  participant G as Grid or agent
  participant AP as Appium
  participant D as Device
  K->>DB: mobile test, grid (key encrypted)
  K->>K: decrypt key, build capabilities
  alt BrowserStack or LambdaTest
    K->>G: POST /session (hub, capabilities)
    G->>AP: allocate real device
  else local Appium
    K->>G: request through AgentHttp (pool)
    G->>AP: POST /session
  end
  AP->>D: install and launch app
  loop each step
    K->>AP: find element (locator), tap, type, swipe
    AP->>D: act
    AP-->>K: result
  end
  K->>AP: screenshot
  K->>AP: DELETE /session
  K->>DB: step results, device, session link, screenshot
```

## 8. A failure becomes an issue and an analysis

```mermaid
sequenceDiagram
  participant K as Worker
  participant DB as PostgreSQL
  participant AI as Gemini (optional)
  participant T as Issue tracker
  participant SCM as GitHub / GitLab
  K->>DB: result Failed
  opt AI configured
    K->>AI: step, error, screenshot
    AI-->>K: category, confidence, explanation
    K->>DB: ai_analysis on the result
  end
  K->>DB: issue_links by dedupe key (plan, test, browser)
  alt not filed yet
    K->>T: create issue
    K->>DB: insert link
  else already filed
    K->>T: comment, recurrence
    K->>DB: occurrences + 1
  end
  K->>SCM: commit status success or failure with report link
```

## 9. Recording a test

```mermaid
sequenceDiagram
  actor U as Person
  participant B as Browser (client)
  participant W as Web process
  participant PW as PlaywrightService
  participant S as Target site
  U->>B: Record, enter URL
  B->>W: POST /api/start-recording
  W->>PW: startRecordingSession
  PW->>S: open visible window on the server machine
  U->>S: clicks, types
  PW->>PW: recorder script reports actions, frames
  B->>W: GET /api/get-recorded-actions (poll)
  U->>B: Stop
  B->>W: POST /api/stop-recording
  W-->>B: sequence of steps with element selectors
```

Recording opens a window on the machine of the web process, which is why the test lab has a virtual
display (see [Test lab](../admin/test-lab)); the other browser work is delegated to workers.

## Dedicated Cucumber execution

After preconditions, `bdd-execution.ts` resolves a tenant/project-authorized binding and uses
`agents/agent-bdd.ts`. The agent executes the installed support revision in a child process;
cleanup runs afterward. Browser/locale lanes are independent of these units. Profile absence,
revision mismatch, cancellation and output budgets are explicit failure paths. See
[BDD tests](../guide/bdd-tests) and [suite handbook](./suite-handbook).

```mermaid
sequenceDiagram
  participant W as Worker
  participant DB as Tenant DB
  participant R as Relay
  participant A as Local agent
  participant C as Cucumber child
  W->>DB: Resolve authorized exact profile/revision
  W->>R: Request signed BDD session
  R->>A: Organization/pool/profile/revision ticket
  A->>C: Source selection and World variables
  C-->>A: Bounded steps/hooks/status/attachments
  A-->>W: Validated result
  W->>DB: Redacted evidence and verdict
```
