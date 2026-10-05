# Standard Gherkin and executable Cucumber integration

Date: 2026-10-04
Branch: `codex/bdd-cucumber-execution`
Base: `096e596b9fae9af8e7bb665e873f83ec47588c44` (merged PR #293).
Status: approved by the user on 2026-10-04, including implementation, validation and PR delivery.

## Intent and success criteria

The user requests completion of BDD/Cucumber: the existing English subset rejects Rule,
doc strings and step data tables, and ordinary Gherkin imports only as manual tests.
Deliver standard Gherkin import/export and real execution against customer-owned
Cucumber step definitions, integrated with saved tests, approved revisions, plans,
reports, organization isolation and authenticated local agents.

Existing web actions restored from WFM metadata and existing manual imports remain
compatible. Import never silently turns prose into browser actions or executes code.
Users explicitly choose manual or Cucumber execution. No customer Node.js code runs
inside the shared API/worker process. Preserve existing local files and Collaudo results.

## Approaches and selected proposal

1. **Recommended: Cucumber.js adapter on a dedicated agent.** A genuine Cucumber
   runtime provides step matching, hooks, World, parameter types, doc strings and
   DataTable arguments. Operators provision support-code projects and named execution
   profiles; organization administrators bind tests to available profiles. A dedicated
   agent may run on the customer's machine or in the supplied isolated container.
2. **Alternative: external runtime command adapter.** Supports existing Java/.NET
   projects but requires additional command/report contracts, identity mapping and
   platform-specific process lifecycle handling. Do not advertise these runtimes as
   supported by the first implementation. Keep the persisted provider discriminator
   and agent execution boundary extensible instead of coupling tests to a global runtime.

Initial proposal assumes JavaScript/TypeScript Cucumber.js unless the user selects the
external-runtime option. Profiles are configurable per organization/project; the
operator controls executable code and permitted profiles on each agent. No universal
provider or step library is hard-coded into organization settings.

## Gherkin parser and representation

Replace handwritten grammar recognition with official `@cucumber/gherkin` and
`@cucumber/messages` AST/pickle compilation, using versions compatible with the existing
Node 20 installation. Support standard dialect headers, descriptions, Rule and its
Background, Feature Background, Scenario/Outline, multiple tagged Examples, escaped
table cells, doc strings (including content type and indentation) and step data tables.
Retain official source locations and compiler-expanded arguments/tags. Keyword types
determine manual expected results, independent of the displayed language.

Persist nullable validated `bdd` JSON on web-test records rather than inventing a new
plan test type. It carries source dialect/text, logical source name, scenario/Examples
row selection, expanded step arguments/tags and optional execution binding. A stable
source-location selector selects exactly one compiled scenario; random parser IDs or
scenario names alone must not be used as persistent identity. Each Examples row becomes
one saved test, including inherited Background and Rule context. Identical names in
different Rules receive unambiguous names; conflicting final names are rejected.

Retain the existing input caps: 20 MiB, 2,000 expanded tests and 100,000 expanded steps.
Reject parse errors with line/column, malformed WFM metadata, duplicate imports and
invalid/dangling scenario selectors. Enforce expansion and argument byte limits before
persisting or dispatching. Unknown dialects report a validation error, not YAML fallback.
Automatically detect localized `.feature` contents in the CLI as well as explicit UI format.

## Import, export and editing

The Files import dialog offers manual/Cucumber mode and, for Cucumber, an available
execution profile. Preview exposes dialect, Rule, scenario, argument types, inherited
tags and execution mode. Manual imports retain readable steps plus structured arguments;
the tester can inspect multiline doc strings and tables. They continue to await a verdict.

Cucumber imports retain their source and concrete scenario selector. The test editor
displays Gherkin, mode and profile, validates changes through the same parser and offers
explicit conversion to manual execution. Editing source must update the selector and
expanded steps atomically; ordinary web-builder edits cannot silently desynchronize BDD.

Gherkin export preserves dialect, Rule context, tags and structured arguments for BDD
tests. Exporting selected Outline rows must not reintroduce unselected scenarios. The
result is valid independently runnable Gherkin; executable profile bindings remain WFM
metadata, not portable credentials. Existing `# wfm-test:` exports still restore web
actions, with full semantic comparison to detect edited prose. YAML/JSON export includes
BDD fields. Imported bindings from another installation require explicit authorized
profile mapping; importing metadata cannot select an arbitrary local filesystem path.

## Configurable execution profiles and trust boundary

An operator-provisioned JSON manifest on the agent defines named profiles: provider
`cucumber-js`, approved project directory, support-file globs, optional TypeScript loader,
maximum run duration, concurrency, allowed environment-variable names and a declared
support-project revision. Agent registration exposes only profile IDs/display labels,
provider, revision and limits, never paths, commands or secrets. Profile provisioning is
an operator action; tenants cannot send require/import paths, loaders or shell commands.

Organization/project configuration selects from profiles advertised by its authorized
agent pool. Tests store profile ID and approved support revision. A changed revision
requires rebinding and publication; a missing/mismatched profile fails before code loads.
Tickets bind organization, pool, BDD capability and profile/revision, including cluster
relay selection. Earlier agents remain compatible for existing tests and cannot receive
BDD jobs. Upgrade the distributed agent version and setup/docs accordingly.

A dedicated agent is organization-owned and is not a multi-tenant Node.js sandbox.
Provide a ready-to-use dedicated container example: non-root, dropped capabilities,
read-only root/support project, bounded temporary storage/resources, no Docker socket,
no host or SaaS DB credentials. Supply profile/sample JS and TS support projects and an
explicit network-policy attachment procedure. Process separation alone is not claimed
to sandbox hostile support code. Shared web/worker images do not execute support modules.

## Execution and process lifecycle

WebFlowMaster sends the approved feature/scenario selector, authorized variables and
binding over an authenticated agent BDD session. The agent validates the signed binding
and profile, creates a bounded temporary run directory and launches a fresh child process
using executable plus argument array (`shell: false`). Cucumber.js 12.x is compatible
with Node 20; pin the selected compatible release in runtime/distribution lockfiles.
Support JS CJS/ESM and TypeScript through the operator-approved loader. Do not install
dependencies or fetch a repository in response to a tenant execution request.

The child uses Cucumber's API and message formatter. It runs exactly the selected
scenario; no arbitrary project CLI config may override feature selection, output paths,
strictness or publishing. Disable external report publishing. Retain step definition
matching, hooks, isolated World and registered parameter types. Variables are explicit
World parameters and an allowlisted environment map, never inherited worker environment.
Do not expand Gherkin `<...>` or `{{...}}` a second time outside their documented context.

Enforce duration, output/message/attachment byte caps and concurrency. Abort, disconnect
and timeout terminate the child and owned descendants on Windows/Linux; cleanup runs
on every outcome. Parse messages incrementally, validate result identity and require a
complete test-run terminal event plus successful exit. Missing/truncated/malformed results,
zero selected scenarios and crashes are failures. Failed, undefined, ambiguous, pending
or skipped steps cannot become a passed test. Hooks and their failures are recorded.

## Plans, versions and reports

BDD remains a web test for authorization/library/plan links but dispatches through a
distinct execution branch before manual/browser classification. Include `bdd` in save
schemas, version snapshots, review diffs, published test resolution and bundles. The
approved source, selector and support revision are immutable in published runs.
Do not execute the same non-browser BDD scenario once per browser matrix entry; profile
parameters determine any customer-controlled browser choice. Define one plan result per
selected saved scenario and dataset row, with the existing retries and failure policies.

Persist bounded normalized scenario/step/hook results, durations, diagnostic locations
and safe attachments in the existing result/evidence/report model. Render doc strings and
tables safely, never HTML from a support-code attachment. Redact environment secrets and
known credential fields before logs, relay error text, persisted evidence and downloads.
Never store support project paths or unrestricted stdout. Existing analytics and failure
summaries use the normalized test verdict; undefined steps display actionable diagnostics.

## Authorization and migration

Apply the next available migration (verify journal head immediately before writing)
for nullable `tests.bdd`; existing tests are unchanged. Profile configuration follows
existing organization administrator/project write policies, test edit/import permissions,
publication approval and audit conventions. All lookups are organization/project scoped;
real PostgreSQL RLS tests prove cross-organization profile/test/result isolation. Revoked
agents/profiles cannot start new sessions; no fallback to local shared worker execution.

## Validation and delivery

- Parser fixtures: EN/IT/FR/DE and another dialect; Rule/Background ordering, Outline
  substitution in doc strings/tables, escaped cells, tags, errors, caps and metadata edits.
- Manual and executable round-trips, selected Outline rows, source editing and authorized
  profile mapping through UI/API/CLI; immutable published runs and restore/export.
- Real Cucumber support projects on a real authenticated agent: JS/TS matching, hooks,
  World, doc strings, DataTables; failed/undefined/ambiguous/pending/skipped outcomes.
- Lifecycle: abort/deadline/descendant cleanup, malformed or oversized messages, bounded
  attachments, profile/revision mismatch, unauthorized paths/commands, secret redaction.
- Clustered relay selection, older agents, real PostgreSQL RLS and production UI journeys
  from import and profile binding through plan execution and report inspection.
- Typecheck/lint, server/client suites, Collaudo app, application/docs/agent builds,
  guarded deployment and production checks. Add EN/IT docs, EN/IT/FR/DE UI translations
  and new Collaudo cases without renaming existing IDs or inventing manual results.
- Independent review, commit/push, attach a PR, inspect actual-head CI and mark ready
  only when green. User approval may authorize the plan and implementation through PR
  without additional intermediate approval requests. Never merge the PR automatically.

## Primary references

- https://cucumber.io/docs/gherkin/reference/
- https://github.com/cucumber/gherkin
- https://github.com/cucumber/cucumber-js/blob/main/docs/javascript_api.md
- Runtime compatibility verified from npm package engine declarations: Cucumber.js
  12.9.0 supports Node 20; 13.2.1 requires Node 22 or newer and is not selected here.
