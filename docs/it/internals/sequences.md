# Diagrammi di sequenza

I flussi principali del sistema come interazioni fra i processi e gli archivi descritti in
[Architettura di sistema](./system-architecture). Ogni diagramma è seguito dai punti in cui è facile
sbagliare. La versione in prosa del flusso di un run, con tutti i casi limite, è
[Ciclo di vita di un run](./execution). I diagrammi sono in inglese, come i nomi nel codice.

## 1. Accesso con password e secondo fattore

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

- L'accesso ha un limite per indirizzo (`AUTH_RATE_LIMIT`, 20 ogni 15 minuti di default).
- Un passo TOTP si accetta una volta sola (`last_used_step`), quindi un codice copiato non si può riusare.

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

## 3. Una richiesta dal browser, sotto row-level security

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

Il `WHERE organization_id = 42` *non* è nella query: lo aggiunge la policy, quindi un filtro dimenticato non
può far uscire le righe di un'altra organizzazione.

## 4. Un piano viene eseguito

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

- **Esattamente uno stato terminale:** ogni cambio di stato è un `UPDATE … WHERE status = …` condizionale; un
  scrittore in ritardo o duplicato non cambia nulla.
- **Gli effetti collaterali non decidono l'esito:** l'ultima freccia può fallire e il run resta `completed` o
  `failed`.
- Un worker che muore viene trovato dal controllo di recupero (heartbeat più vecchio di `RUN_STALE_AFTER_MS`).

## 5. Una pipeline esegue un piano (CLI)

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

## 6. Un browser preso in prestito da un agente locale

Il protocollo in dettaglio è in [Agenti locali (interni)](./agents).

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

## 7. Un test mobile su un dispositivo

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

## 8. Un fallimento diventa un'issue e un'analisi

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

## 9. Registrare un test

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

La registrazione apre una finestra sulla macchina del processo web, ed è per questo che l'ambiente di collaudo
ha uno schermo virtuale (vedi [Ambiente di collaudo](../admin/test-lab)); il resto del lavoro sui browser è
delegato ai worker.
