# Class diagrams

WebFlowMaster is written mostly as modules of functions: decisions are pure functions in their own
files, effects are in the modules that perform them. The product therefore has few classes, and the
ones it has sit exactly where *state with a lifetime* is needed — a WebSocket relay, a browser pool, a
device session, a debugger. This page draws them, and draws next to them the **domain model**: the
types that the whole system passes around, which are interfaces and records rather than classes.

All diagrams are taken from the code. Signatures are abbreviated to what matters; the file is named
on each diagram so the full definition is one search away. For the tables behind the domain types see
[Database schema](./database-schema).

## 1. The domain model

The business concepts and how they relate. Each box is a database table or a stored document; the
database column names are in [Database schema](./database-schema).

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

Three things the diagram cannot show:

- **A run is frozen when it is requested.** `Execution.snapshot` holds the plan's configuration and the
  *resolved list of tests*; editing the plan afterwards changes nothing about a run that exists.
- **Coverage is computed, never stored.** `Requirement.coverage` comes from the latest results of the
  tests that cover it (`shared/requirements.ts`).
- **A test result belongs to a test *and a browser*.** One test on three browsers is three
  `TestResult` rows, each with its own attempts, evidence and verdict.

## 2. Run creation and control

The orchestrator creates runs; `execution-state` is the only place a run's status changes; the
worker's `RunnerAgent` keeps the process visible. These are the types around them.

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

The run's status machine (`queued → running → completed | failed | error | timed_out`, with
`cancelling → cancelled`) is drawn in [Run lifecycle](./execution#_2-the-state-machine).

## 3. Execution of tests

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

Notes:

- `PlaywrightService` is the largest class (recording, element detection, step execution helpers). A
  run does not use it as a bag of methods: `test-execution-service.ts` and `step-executor.ts` use its
  browser sessions and the pure helpers around it.
- `DebugChannel` has two implementations: `memoryDebugChannel` when browser tasks run inline in the web
  process, and `redisDebugChannel` when a worker runs them, which is what makes the step debugger
  work with the browser on a worker and the person on a web server.
- `AgentHttp` is described in [Local agents (internals)](./agents#api-requests-from-the-agent).

## 4. Mobile

The mobile subsystem is a vertical slice of its own; see [Mobile subsystem](./mobile) for the story.

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

## 5. Agents and the relay

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

## 6. Storage, tenancy and cross-cutting types

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

### The errors

Each area has its own `Error` subclass carrying a *code* the route turns into a status and a
sentence. None is caught by type outside its own area; a generic handler turns the rest into a `500`
and an incident.

| Class | File | Raised when |
|---|---|---|
| `ExecutionEnqueueError` | `execution-orchestrator.ts` | A run cannot be created: unknown plan, queue full, queue unreachable, invalid input. |
| `BrowserTaskError` | `browser-tasks.ts` | A task for a worker timed out, was refused or found no worker. |
| `TenantConflictError` | `middleware/tenancy.ts` | Code tries to run in two organizations at once. |
| `PublishingError`, `QuarantineError` | `test-publishing.ts`, `test-quarantine.ts` | A test cannot be published, reviewed or quarantined in its current state. |
| `SsoConfigError` | `sso.ts` | The provider's configuration is invalid or unreachable. |
| `ReportExportError` | `report-export.ts` | A report cannot be rendered. |
| `WebDriverError` | `appium-client.ts` | The Appium server answered with a W3C WebDriver error. |
| `InspectorError` | `mobile-inspector.ts` | An inspector session is gone, busy or refused. |

## 7. How to read the code with these diagrams

- Start from a **record** (`ExecutionSnapshot`, `StepResult`, `MobileStep`): they are the contracts
  between the web process, the worker, the client and the stored JSON. Most of them live in `shared/`
  so the client and the server cannot disagree.
- A **module** box (`<<module>>`) is a file of functions. Its pure part is tested directly; its
  effects are tested against PGlite or an HTTP fake.
- A **class** box is state with a lifetime: it owns a socket, a browser or a timer, so it has an
  explicit `close()` or `stop()` and a test that calls it.
