# Diagrammi delle classi

WebFlowMaster è scritto per lo più come moduli di funzioni: le decisioni sono funzioni pure in file propri, gli
effetti stanno nei moduli che li eseguono. Il prodotto ha quindi poche classi, e quelle che ha stanno proprio
dove serve *uno stato con una vita*: un relay WebSocket, un pool di browser, una sessione su un dispositivo, un
debugger. Questa pagina le disegna e disegna accanto il **modello di dominio**: i tipi che l'intero sistema si
scambia, che sono interfacce e record più che classi. I diagrammi sono in inglese, come i nomi nel codice.

Tutti i diagrammi sono ricavati dal codice. Le firme sono abbreviate a ciò che conta; su ogni diagramma è
indicato il file, così la definizione completa è a una ricerca di distanza. Per le tabelle dietro i tipi di
dominio vedi [Schema del database](./database-schema).

## 1. Il modello di dominio

I concetti di business e come si collegano. Ogni riquadro è una tabella del database o un documento salvato; i
nomi delle colonne sono in [Schema del database](./database-schema).

```mermaid
classDiagram
  direction LR
  class Organization {
    +id
    +name
    +maxConcurrentRuns
    +maxQueuedRuns
    +mfaRequired
    +testReviewRequired
  }
  class User {
    +id
    +username
    +role : owner / editor / viewer
    +kind : person / service
  }
  class Project {
    +id
    +name
    +restricted
  }
  class UiTest {
    +sequence : Step[]
    +elements
    +preconditions
    +dataset
    +status
    +publishedVersion
  }
  class ApiTest {
    +method
    +url
    +assertions
    +extractions
    +authType
  }
  class MobileTest {
    +platform : android / ios
    +app
    +deviceName
    +steps : MobileStep[]
  }
  class TestVersion {
    +version
    +sequence
    +summary
  }
  class TestReview {
    +status
    +decidedBy
  }
  class Tag
  class Suite {
    +kind : static / dynamic
    +tagIds
  }
  class Requirement {
    +key
    +kind : epic / story / requirement
    +coverage : computed
  }
  class TestPlan {
    +browsers
    +evidence settings
    +failure policies
    +rerun policy
    +maxParallelTests
    +agentPool
    +browserGridId
  }
  class Schedule {
    +frequency
    +timezone
    +isActive
  }
  class Webhook {
    +tokenHash
  }
  class Execution {
    +status
    +snapshot
    +idempotencyKey
    +attempt
    +ciContext
    +failureCode
  }
  class TestResult {
    +testType
    +browser
    +status
    +attempts
    +quarantined
    +evidence paths
    +aiAnalysis
  }
  class Environment {
    +name
    +savedLogin
  }
  class Secret
  class IssueTracker
  class IssueLink
  class TestManagementConnection
  class BrowserGrid {
    +provider
    +agentPool
  }
  class Agent {
    +pool
    +tokenHash
  }

  Organization "1" --> "*" User
  Organization "1" --> "*" Project
  Project "1" --> "*" UiTest
  Project "1" --> "*" ApiTest
  Project "1" --> "*" MobileTest
  UiTest "1" --> "*" TestVersion : history
  UiTest "1" --> "*" TestReview
  UiTest "*" -- "*" Tag
  ApiTest "*" -- "*" Tag
  MobileTest "*" -- "*" Tag
  Suite "*" o-- "*" UiTest
  Suite "*" o-- "*" ApiTest
  Suite "*" o-- "*" MobileTest
  Requirement "*" -- "*" UiTest : covered by
  TestPlan "*" o-- "*" Suite
  TestPlan "*" o-- "*" UiTest : selects
  TestPlan "1" --> "*" Schedule
  TestPlan "1" --> "*" Webhook
  TestPlan "1" --> "*" Execution : runs as
  Schedule "1" --> "*" Execution : fires
  Execution "1" --> "*" TestResult
  TestResult "*" --> "0..1" IssueLink : filed as
  IssueTracker "1" --> "*" IssueLink
  TestPlan "*" --> "0..1" IssueTracker
  TestPlan "*" --> "0..1" TestManagementConnection
  TestPlan "*" --> "0..1" BrowserGrid
  MobileTest "*" --> "0..1" BrowserGrid
  BrowserGrid "*" ..> "0..*" Agent : local Appium pool
  Environment "1" --> "*" Secret
  Execution "*" ..> "0..1" Environment
  Organization "1" --> "*" Environment
```

Tre cose che il diagramma non può mostrare:

- **Un run è congelato quando viene richiesto.** `Execution.snapshot` contiene la configurazione del piano e
  l'*elenco risolto dei test*; modificare il piano dopo non cambia nulla di un run già esistente.
- **La copertura si calcola, non si salva.** `Requirement.coverage` deriva dagli ultimi risultati dei test che
  la coprono (`shared/requirements.ts`).
- **Un risultato appartiene a un test *e a un browser*.** Un test su tre browser sono tre righe `TestResult`,
  ciascuna con i propri tentativi, evidenze ed esito.

## 2. Creazione e controllo dei run

L'orchestratore crea i run; `execution-state` è l'unico posto in cui cambia lo stato di un run; il `RunnerAgent`
del worker mantiene visibile il processo. Questi sono i tipi intorno a loro.

```mermaid
classDiagram
  direction TB
  class ExecutionOrchestrator {
    <<module: execution-orchestrator.ts>>
    +enqueue(input EnqueueExecutionInput) Execution
    +retryFailedRun(execution) Execution
  }
  class ExecutionQueuePort {
    <<interface>>
    +add(name, data, options) Promise
  }
  class EnqueueExecutionInput {
    +planId
    +requestedByUserId
    +trigger : manual / scheduled / webhook / api
    +environmentId
    +browsers
    +updateBaselines
    +scheduleId
    +maxAttempts
    +idempotencyKey
    +ciContext
  }
  class ExecutionEnqueueError {
    +code : EnqueueFailureCode
    +status
    +executionId
  }
  class ExecutionSnapshot {
    <<record: execution-snapshot.ts>>
    +version
    +capturedAt
    +plan
    +browsers
    +selectedTests : SnapshotTestReference[]
    +visualTesting
    +evidence
    +maxParallelTests
    +timeouts
    +failurePolicies
    +rerunPolicy
    +issues
    +runOn
    +locales
  }
  class SnapshotTestReference {
    +testType : ui / api / mobile
    +testId
    +apiTestId
    +mobileTestId
  }
  class ExecutionState {
    <<module: execution-state.ts>>
    +canTransitionExecution(from, to) bool
    +transitionExecution(id, to, patch)
    +takeExecution(id, runner) TakeOutcome
    +requestCancellation(id) CancellationOutcome
    +recordHeartbeat(id)
    +onExecutionTransition(listener)
  }
  class RunPolicies {
    <<record: run-policies.ts>>
    +step : StepRuntime
    +testReruns
    +onPreconditionFailure
    +stopOnStepFailure
    +stopOnAbortedTest
    +notApplied
  }
  class RunnerAgent {
    <<class: runner-registry.ts>>
    +register() Promise~string~
    +start(intervalMs)
    +tick() Promise
    +stop() Promise
  }
  class PausableQueue {
    <<interface>>
    +pause(doNotWaitActive)
    +resume()
  }
  class RunRecovery {
    <<module: run-recovery.ts>>
    +recoverAbandonedRuns(options) RecoveryReport
    +startRunRecovery()
  }

  ExecutionOrchestrator ..> ExecutionQueuePort : submits one job per run
  ExecutionOrchestrator ..> EnqueueExecutionInput : takes
  ExecutionOrchestrator ..> ExecutionSnapshot : builds
  ExecutionOrchestrator ..> ExecutionEnqueueError : throws
  ExecutionOrchestrator ..> ExecutionState : first transition
  ExecutionSnapshot "1" *-- "*" SnapshotTestReference
  ExecutionSnapshot ..> RunPolicies : read by the worker into
  RunnerAgent ..> PausableQueue : drains on request
  RunRecovery ..> ExecutionState : ends abandoned runs
```

La macchina a stati del run (`queued → running → completed | failed | error | timed_out`, con
`cancelling → cancelled`) è disegnata in [Ciclo di vita di un run](./execution).

## 3. Esecuzione dei test

```mermaid
classDiagram
  direction TB
  class PlaywrightService {
    <<class: playwright-service.ts>>
    +startRecordingSession(url, userId)
    +stopRecordingSession(id, userId)
    +getRecordedActions(id, userId)
    +detectElements(url, userId) DetectionResult
    +captureLoginState(sessionId, environment)
    +registerSession(id, session)
    +disposeAllRecordingSessions()
  }
  class BrowserPool {
    <<singleton: browser-pool.ts>>
    +getInstance()$ BrowserPool
    +acquire(browserType, headless) Browser
    +release(browser)
  }
  class FlowCursor {
    <<class: flow-cursor.ts>>
    +advance(outcome) string
    +iterationKey() string
  }
  class StepResult {
    <<record>>
    +name
    +type
    +status : passed / failed
    +screenshot
    +error
    +healed
    +visual
    +accessibility
  }
  class AgentHttp {
    <<class: agents/agent-fetch.ts>>
    +fetch : fetch through a borrowed browser
    +close() Promise
  }
  class AIAutomationService {
    <<class: ai-automation-service.ts>>
    +isAvailable() bool
    +proposeTestSteps(prompt)
    +proposeTestCases(prompt)
    +explainFailure(prompt, screenshot)
    +healSelector(selector, pageSource, error)
  }
  class DebugController {
    <<class: debug-session.ts>>
    +watch(vars)
    +record(record) Promise
    +finish(outcome) Promise
    +fail(message) Promise
  }
  class DebugHooks {
    <<interface>>
    +watch(vars)
    +beforeStep(context) DebugDecision
    +afterFailure(context) DebugDecision
    +record(record)
    +finish(outcome)
  }
  class DebugChannel {
    <<interface>>
    +open(id, meta)
    +publish(id, state)
    +read(id) DebugState
    +send(id, command)
    +drain(id) DebugCommand[]
    +next(id, ms) DebugCommand
  }
  class ExcelService {
    <<class: excel-service.ts>>
    +parseExcelFile(path) ExcelTestCase[]
    +detectColumns(path) string[]
  }
  class AppiumSession {
    <<class: appium-client.ts>>
    +open(request)$ AppiumSession
    +find(locator) string
    +click(element)
    +type(element, text)
    +drag(from, to, durationMs)
    +source() string
    +screenshot() string
    +close()
  }
  class WebDriverError

  PlaywrightService ..> BrowserPool : local browsers
  PlaywrightService ..> FlowCursor : conditions and loops
  PlaywrightService ..> StepResult : produces
  PlaywrightService ..> AIAutomationService : healing, optional
  PlaywrightService ..> DebugHooks : pauses when debugged
  DebugController ..|> DebugHooks
  DebugController ..> DebugChannel : state out, commands in
  AppiumSession ..> WebDriverError : throws
```

Note:

- `PlaywrightService` è la classe più grande (registrazione, rilevamento degli elementi, aiuti per l'esecuzione
  degli step). Un run non la usa come un sacco di metodi: `test-execution-service.ts` e `step-executor.ts`
  usano le sue sessioni di browser e gli aiuti puri che la circondano.
- `DebugChannel` ha due implementazioni: `memoryDebugChannel` quando i browser task girano inline nel processo
  web, e `redisDebugChannel` quando li esegue un worker; è ciò che fa funzionare il debugger passo-passo con il
  browser su un worker e la persona su un server web.
- `AgentHttp` è descritta in [Agenti locali (interni)](./agents).

## 4. Mobile

Il sottosistema mobile è una fetta verticale a sé; la sua storia è in [Sottosistema mobile](./mobile).

```mermaid
classDiagram
  direction LR
  class MobileTest {
    <<table mobile_tests>>
    +platform
    +app
    +deviceName
    +osVersion
    +gridId
    +steps : MobileStep[]
  }
  class MobileStep {
    +id
    +action : MobileActionId
    +target
    +value
  }
  class MobileLocator {
    +using
    +value
  }
  class MobileStepResult {
    +index
    +action
    +status : passed / failed / skipped
    +error
    +durationMs
  }
  class MobileRunner {
    <<module: mobile-runner.ts>>
    +executeMobileRun(runId, organizationId, userId)
    +performMobileTest(...) steps and verdict
    +runMobileStep(ctx, step)
    +mobileSessionRequest(grid, test)
    +appiumTransport(grid) fetch
    +uploadApp(grid, filePath, fileName)
  }
  class GridConfig {
    +provider
    +endpoint
    +username
    +key
    +agentPool
  }
  class AppiumSession {
    <<class>>
    +open(request)$
    +find(locator)
    +click(element)
    +type(element, text)
    +source()
    +screenshot()
  }
  class MobileInspector {
    <<module: mobile-inspector.ts>>
    +openInspector(...) sessionId
    +inspectorSnapshot(id, owner)
    +inspectorAct(id, owner, action)
    +closeInspector(id, owner)
  }
  class AgentHttp {
    <<class>>
  }
  class BrowserGrid {
    <<table browser_grids>>
    +provider : browserstack / lambdatest / playwright_server / local_appium
  }

  MobileTest "1" *-- "*" MobileStep
  MobileStep ..> MobileLocator : parseMobileLocator
  MobileRunner ..> MobileTest : runs
  MobileRunner ..> GridConfig : decrypts key
  MobileRunner ..> AppiumSession : one per run
  MobileRunner ..> MobileStepResult : produces
  MobileRunner ..> AgentHttp : local Appium goes through the agent
  MobileInspector ..> AppiumSession : live session
  MobileTest "*" --> "0..1" BrowserGrid
  GridConfig ..> BrowserGrid : from
```

## 5. Agenti e relay

```mermaid
classDiagram
  direction TB
  class AgentRelay {
    <<class: agents/relay.ts>>
    -connected : Map
    -pending : Map
    +attach(server)
    +isConnected(agentId) bool
    +sessionsOf(agentId) int
    +availability(ticket) available or reason
    +disconnect(agentId, reason)
    +sync() Promise
    +close()
    -choose(ticket, localOnly) Candidate
    -acceptAgent(req, socket, head)
    -acceptRunner(req, socket, head)
    -acceptSession(req, socket, head, id)
    -forward(req, socket, head, instance)
  }
  class AgentRelayOptions {
    +authenticate(token) RelayAgent
    +onSeen(agentId, hello)
    +secret() string
    +openTimeoutMs
    +heartbeatMs
    +cluster : RelayCluster
  }
  class RelayCluster {
    +directory : RelayDirectory
    +instanceId
    +url
    +syncMs
  }
  class RelayDirectory {
    <<interface>>
    +publish(instance, ttlMs)
    +instances() RelayInstance[]
    +withdraw(instanceId)
  }
  class MemoryRelayDirectory
  class RedisRelayDirectory
  class RelayInstance {
    +id
    +url
    +agents : PublishedAgent[]
  }
  class PublishedAgent {
    +id
    +organizationId
    +pool
    +playwrightVersion
    +browsers
    +maxSessions
    +activeSessions
    +draining
  }
  class RunnerAgentProgram {
    <<program: scripts/wfm-agent.ts>>
    +control connection
    +launchServer()
    +session pipes
    +reconnect with backoff
    +drain on SIGTERM
  }
  class BrowserTicket {
    <<HMAC, 60 s>>
    +organizationId
    +pool
    +engine
    +channel
    +headless
    +playwrightVersion
    +expiresAt
  }

  AgentRelay "1" o-- "1" AgentRelayOptions
  AgentRelayOptions "1" o-- "0..1" RelayCluster
  RelayCluster "1" --> "1" RelayDirectory
  MemoryRelayDirectory ..|> RelayDirectory
  RedisRelayDirectory ..|> RelayDirectory
  RelayDirectory ..> RelayInstance
  RelayInstance "1" *-- "*" PublishedAgent
  AgentRelay ..> BrowserTicket : verifies
  RunnerAgentProgram ..> AgentRelay : dials out over WSS
```

## 6. Archiviazione, tenancy e tipi trasversali

```mermaid
classDiagram
  direction LR
  class IStorage {
    <<interface: storage.ts>>
    +getUser(id)
    +getUserByUsername(username)
    +createUser(user)
    +createUserFromInvitation(user, token, ...)
    ...
  }
  class DatabaseStorage
  class DatabaseSessionStore {
    <<express-session store>>
  }
  class ArtifactStore {
    <<interface: artifact-store.ts>>
    +kind : local / s3
    +read(key) Buffer
    +write(key, body, contentType)
    +open(key) StoredArtifact
    +publishDirectory(localDir) int
    +deletePrefix(prefix) int
  }
  class LocalArtifactStore
  class S3ArtifactStore
  class TenancyMiddleware {
    <<module: middleware/tenancy.ts>>
    +tenancyMiddleware(req, res, next)
    +runWithTenant(org, fn, principal)
    +runAsOrganization(org, fn)
    +withTenantTransaction(fn)
    +getTenantOrgId() int
  }
  class PrivilegedDb {
    <<db.ts: privilegedDb>>
    uses are counted by a test
  }
  class TenantConflictError
  class IncidentStore {
    <<class: observability/store.ts>>
    +upsert(incident) Incident
    +read(id) Incident
    +readIndex() IncidentIndexEntry[]
    +prune(options) int
  }
  class BreadcrumbRing
  class Incident {
    +id
    +fingerprint
    +kind : server-api / client-runtime / job / runner
    +status : open / fixed / ignored
    +count
    +error
    +breadcrumbs
  }
  class LokiTransport {
    <<winston transport>>
  }

  DatabaseStorage ..|> IStorage
  LocalArtifactStore ..|> ArtifactStore
  S3ArtifactStore ..|> ArtifactStore
  IncidentStore ..> Incident : stores as files
  IncidentStore ..> BreadcrumbRing : context
  TenancyMiddleware ..> TenantConflictError : throws
  TenancyMiddleware ..> PrivilegedDb : opens the tenant transaction on
```

### Gli errori

Ogni area ha la propria sottoclasse di `Error` con un *codice* che la rotta trasforma in uno stato e in una
frase. Nessuna viene intercettata per tipo fuori dalla sua area; un gestore generico trasforma il resto in un
`500` e in un incidente.

| Classe | File | Sollevata quando |
|---|---|---|
| `ExecutionEnqueueError` | `execution-orchestrator.ts` | Non si può creare un run: piano sconosciuto, coda piena, coda irraggiungibile, input non valido. |
| `BrowserTaskError` | `browser-tasks.ts` | Un task per un worker è scaduto, è stato rifiutato o non ha trovato un worker. |
| `TenantConflictError` | `middleware/tenancy.ts` | Il codice tenta di eseguire in due organizzazioni insieme. |
| `PublishingError`, `QuarantineError` | `test-publishing.ts`, `test-quarantine.ts` | Un test non può essere pubblicato, revisionato o messo in quarantena nel suo stato attuale. |
| `SsoConfigError` | `sso.ts` | La configurazione del provider non è valida o è irraggiungibile. |
| `ReportExportError` | `report-export.ts` | Un report non può essere generato. |
| `WebDriverError` | `appium-client.ts` | Il server Appium ha risposto con un errore W3C WebDriver. |
| `InspectorError` | `mobile-inspector.ts` | Una sessione dell'inspector non esiste più, è occupata o è stata rifiutata. |

## 7. Come leggere il codice con questi diagrammi

- Parti da un **record** (`ExecutionSnapshot`, `StepResult`, `MobileStep`): sono i contratti fra processo
  web, worker, client e JSON salvato. Quasi tutti stanno in `shared/`, così client e server non possono
  essere in disaccordo.
- Un riquadro **module** (`<<module>>`) è un file di funzioni. La sua parte pura si testa direttamente; i suoi
  effetti si testano su PGlite o con un finto HTTP.
- Un riquadro **class** è stato con una vita: possiede un socket, un browser o un timer, quindi ha un `close()`
  o `stop()` esplicito e un test che lo chiama.
