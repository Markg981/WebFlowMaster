# Glossary

The words used in the product, in this documentation and in the code, with the table or module where
each lives.

| Term | Meaning |
|---|---|
| **Action** | What a step does: navigate, click, input, assert, wait… The closed list is `ADHOC_ACTION_IDS` (`shared/recording.ts`). |
| **Agent** | A process inside a customer's network that lends Playwright browsers to runs (`agents`, `scripts/wfm-agent.ts`). |
| **API key** | A credential for pipelines and scripts (`wfm_…`), optionally limited by scopes (`api_keys`). |
| **API test** | An HTTP request with assertions and extractions (`api_tests`). |
| **Artifact store** | Where evidence and baselines are kept: local disk or S3 (`server/artifact-store.ts`). |
| **Attempt** | One try of a scheduled run; a failed attempt with attempts left queues the next (`attempt`, `max_attempts`). |
| **Audit log** | The append-only record of who did what (`audit_log`). |
| **Baseline** | The accepted screenshot of a step, which visual testing compares against. |
| **Browser pass / lane** | One browser's run through every test of a plan, with its own captured values. |
| **Browser task** | Browser work a person waits for (preview, single run, page survey), run by a worker on its own queue. |
| **CI context** | The provider, repository, commit, branch and build a pipeline sends with a run (`ci_context`, `shared/ci.ts`). |
| **Commit status** | A run's state shown on the commit it tested, in GitHub or GitLab (`server/commit-status.ts`). |
| **Dataset** | Rows of input a test runs over, one run per row, each row's keys becoming variables. |
| **Detected elements** | Elements found on a page by the builder, for one test (`detected_elements`). |
| **Element repository** | Shared element definitions of a project that steps can reference (`project_elements`). |
| **Environment** | A named target (Staging, Production) with its secret values and optional saved login (`environments`, `secrets`). |
| **Evidence** | What a run keeps besides results: screenshots, video, trace, HAR, visual diffs. |
| **Execution / run** | One execution of a test plan (`test_plan_executions`). |
| **Extraction** | A value read from an API response and made available to later requests as a variable. |
| **Flaky test** | A test whose verdict changes without an explanation; found by `server/flaky.ts`. |
| **Healing** | Replacing a selector that no longer matches with one proposed by the AI, verified by a retry. |
| **Heartbeat** | The periodic write proving a worker still runs a run (`heartbeat_at`), or a runner is alive. |
| **Idempotency key** | A caller-chosen key that makes asking twice return the same run. |
| **Issue tracker** | Jira or Azure DevOps connection used to file failures (`issue_trackers`, `issue_links`). |
| **Login state** | Saved cookies and storage of the application under test, so tests start signed in. |
| **Organization** | The tenant: everything belongs to one (`organizations`). |
| **Orchestrator** | The one place runs are created (`server/execution-orchestrator.ts`). |
| **Plan / test plan** | What to run and how: tests, suites, browsers, policies, notifications (`test_plans`). |
| **Pool** | A named group of agents a plan can run on. |
| **Precondition** | An API call that sets up state before a UI test, optionally skipped when already satisfied. |
| **Project** | A group of tests, usually one application; can be restricted to some members (`projects`). |
| **Publishing** | Pointing a test at one of its versions, which plans then run; optionally after review. |
| **Quarantine** | Setting a test aside: it runs, but its failure does not fail the run (`test_quarantines`). |
| **Quota** | An organization's limits on runs executing and waiting (`organizations`, `server/tenant-quotas.ts`). |
| **Relay** | The component in the web process that pairs runners with agents' browsers (`server/agents/relay.ts`). |
| **RLS** | PostgreSQL row-level security, which keeps organizations apart. |
| **Runner** | A worker process as registered in `runners`, with its heartbeat and desired state (drain). |
| **Schedule** | When a plan runs automatically (`test_plan_schedules`). |
| **Scope** | A permission an API key may be limited to on `/api/v1` (`shared/api-scopes.ts`). |
| **Service account** | A non-human account that holds API keys and cannot sign in. |
| **Snapshot** | The frozen configuration of a run, written when it is requested (`configuration_snapshot`). |
| **Source host** | A connected GitHub or GitLab used for commit statuses (`source_hosts`). |
| **Step** | One action of a UI test, with its target element and value. |
| **Step group** | A named sequence of steps that tests call (`step_groups`). |
| **Suite** | A named set of tests, static (listed) or dynamic (by tags), included by plans (`test_suites`). |
| **Tag** | An organization's own label for tests (`tags`, `test_tags`). |
| **Tenant context** | The organization (and user) bound to the current request or job, via AsyncLocalStorage. |
| **Test** | A UI test: a sequence of steps (`tests`). |
| **Ticket** | A 60-second signed permission for a runner to borrow an agent's browser. |
| **Variable** | A `{{name}}` placeholder resolved from the installation, the environment, a dataset row or an extraction. |
| **Version** | A saved state of a test (`test_versions`); restoring one writes a new version. |
| **Visual testing** | Comparing each step's screenshot with its baseline (`server/visual-testing.ts`). |
| **Webhook** | A URL with a token that CI systems call to start a plan (`test_plan_webhooks`). |
| **Worker** | The process that consumes the queues and runs plans with Playwright (`server/worker.ts`). |
