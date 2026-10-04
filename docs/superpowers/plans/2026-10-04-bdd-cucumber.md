# BDD/Cucumber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps with checkboxes.

**Goal:** Standard multilingual Gherkin with explicit manual or real Cucumber.js execution through organization-owned agents.
**Architecture:** Official parser compiles concrete scenarios. Nullable web-test BDD configuration participates in existing snapshots/bundles. Authorized profiles bind an immutable support revision to authenticated agent child-process execution, with normalized bounded results.
**Tech Stack:** Node 20, TypeScript, Zod, Drizzle/PostgreSQL, React, Cucumber.js 12.9.0, official Gherkin/messages, existing WebSocket agent relay.
**Spec:** `docs/superpowers/specs/2026-10-04-bdd-cucumber-design.md`.

## Global Constraints

- User approved design and plan/implementation/test/PR delivery without further approvals.
- Work on `codex/bdd-cucumber-execution` from merged main `096e596`; preserve unrelated local files.
- No customer support code in shared API/worker processes; operator profiles only, no tenant commands/paths/loaders.
- Gherkin input 20 MiB, 2,000 expanded scenarios, 100,000 expanded steps; total persisted source expansion capped at 64 MiB.
- Dedicated agents are trusted organization-owned execution hosts, not Node sandboxes. Child processes have sanitized environment, deadline, output cap and descendant termination.
- Keep web/manual metadata compatibility, immutable published revisions, existing RLS and guarded network behavior.
- Test first; inspect RED before implementation and GREEN after. Stage only owned files. PR, never merge.

## Review Focus

- Duplicate scenario names under Rules or multiple Examples: stable source-location selectors and unique readable names.
- An Outline row is selected alone: adjacent rows/scenarios must not execute or reappear in selected export.
- Project-deleted/moved or revoked profile: reject unauthorized binding and execution before support modules load.
- Child exit without complete Cucumber terminal events, skipped/undefined steps, excessive attachments: never report success.
- Feature text/doc strings containing credentials or HTML: bounded escaped UI and redaction before persistent diagnostics.

## Contracts

`shared/bdd.ts` owns schema/types (Task 1):
```ts
type BddBinding = { id: string; revision: string };
type BddTest = { language: string; source: string; uri: string;
  scenarioLine: number; exampleLine?: number; mode: 'manual' | 'cucumber'; binding?: BddBinding };
type GherkinImportOptions = { mode?: 'manual' | 'cucumber'; binding?: BddBinding };
```
`parseGherkin(content, options?)` retains its existing return shape and adds `bdd` on imported tests; metadata restores existing web actions. `validateBddTest(bdd)` verifies selector against compiled source.
Root owns `shared/bdd-agent.ts`:
```ts
type BddAgentProfile = { id: string; label: string; revision: string; provider: 'cucumber-js'; maxDurationMs: number };
type BddAgentRequest = { source: string; uri: string; scenarioLine: number; exampleLine?: number;
  profile: { id: string; revision: string }; variables: Record<string,string>; timeoutMs: number };
type BddStepResult = { name: string; keyword?: string; status: string; durationMs: number; error?: string; kind: 'step'|'hook' };
type BddAgentResult = { status: 'passed'|'failed'|'cancelled'; durationMs: number; steps: BddStepResult[]; error?: string };
```
Agent runtime exposes `loadBddProfiles(manifestPath): Promise<OperatorBddProfile[]>`, `publicBddProfiles(profiles)`, `runBddOnDedicatedHost(request, profiles, signal?)`, and `serveBddSession(socket, authorizedProfile, profiles, done)`.
Profiles persisted as `bdd_execution_profiles`: UUID id, organization/project scope, name, pool, operatorProfileId, revision, timeoutMs. Tests bind UUID/revision; dispatch resolves to operator profile ID after tenant/project checks. API paths `/api/bdd/profiles`, `/api/bdd/profiles/available`, CRUD/delete. Only administrator/owner writes; project access and RLS apply.

## Task 1: Standard parser and shared BDD model (parser implementer)

**Own:** `shared/bdd.ts`, `server/gherkin.ts`, new parser helper modules, `server/gherkin.test.ts`, parser-only fixtures; root package/lock dependency changes for Gherkin/messages/Cucumber 12.9.0. Do not touch schema/routes/UI/runtime.

- [ ] Write failing fixtures for Italian Rule, backgrounds and doc strings, escaped DataTables, tagged multiple Examples and location selectors.
```ts
const imported = parseGherkin(source);
expect(imported.tests[0].bdd).toMatchObject({ language:'it', mode:'manual' });
expect(imported.tests[0].sequence[0].gherkin.docString.content).toBe('payload');
```
- [ ] Run `npx vitest run server/gherkin.test.ts`; inspect expected old-parser rejections.
- [ ] Install compatible official dependencies; implement AST/pickle compilation, keyword semantics and argument preservation. Validate bounded output and source selectors through shared schema plus parser helper.
- [ ] Preserve existing metadata round-trip, reject changed readable semantics/arguments, support BDD selected export without running/reintroducing other rows. Detect dialect errors precisely.
- [ ] Add malformed syntax, duplicate Rule names, escaped cells, source expansion caps and EN/IT/FR/DE tests; run focused parser tests/check. Report RED/GREEN and files; root commits integrated work.

## Task 2: Configurable profiles, persistence and authorization (root)

**Own:** shared schema, next migration/journal, shared versioning, test bundle, routes BDD profiles/import/save, profile service and tests, agent contracts.
- [ ] Add failing save/version/export and scoped profile-route tests; API payload carries `bdd` and import options, rejects invalid selector or unauthorized profile even in dry run.
```ts
await request(otherTenant).post('/api/tests/import-bundle').send({content,format:'gherkin',bdd:{mode:'cucumber',binding}}).expect(400);
expect(snapshotOf(test).bdd).toEqual(test.bdd);
```
- [ ] Create migration with `tests.bdd` and profile table, RLS policy/grants using existing migration conventions; register table in tenant schema checks. Add API CRUD/list advertised public profiles and audit actions.
- [ ] Validate profile project scope and revision on save/import/run, preserving original agent pool restrictions. Portable import requires explicit profile mapping.
- [ ] Include BDD in snapshots/bundles, route update transaction, localized auto-detection and result validation. Run profile/bundle/publishing tests and real PostgreSQL isolation.

## Task 3: Dedicated Cucumber runtime (runtime implementer)

**Own:** `scripts/bdd-profiles.ts`, `scripts/bdd-child.ts`, `scripts/agent-bdd-session.ts`, runtime tests/fixtures and dedicated deployment example/sample support projects. No relay/shared schema/UI/agent entrypoint changes.
- [ ] Write failing real-run tests for selected Outline row, doc string/DataTable/World/hooks, undefined and ambiguous steps, deadline/abort and incomplete results.
```ts
const result = await runBddOnDedicatedHost(request, profiles);
expect(result.status).toBe('passed');
expect(result.steps.filter(s => s.kind==='step')).toHaveLength(3);
```
- [ ] Validate operator manifest, safe profile paths/globs/loaders and sanitized public projection. Spawn fresh Node child with argument array and no shell; pass bounded request through stdin, do not inherit agent tokens or shared worker environment.
- [ ] Use actual Cucumber.js API/messages, strict exactly-one selector, bounded step/hook evidence and no publishing. Validate complete terminal events and exit. Prevent project configs overriding controlled source/filter/output.
- [ ] Enforce 300s maximum duration, 8 MiB total child output, 1 MiB attachment budget, bounded step count and profile concurrency. Abort/timeout/disconnect kill owned process tree and remove run directories.
- [ ] Real JS CJS/ESM and TS fixture execution; negative profiles/revisions/zero-scenario/oversize/credentials tests. Provide non-root isolated container, operator manifest and sample JS/TS support projects; network policy deployment procedure. Report exact tests and required entrypoint integration.

## Task 4: Relay, plan dispatch and normalized reporting (root)

**Own:** shared agents/tickets, relay/directory, server agent BDD client, scripts/wfm-agent entrypoint/version/build/Docker dependencies, execution service/report rendering integration and tests.
- [ ] Add failing signed profile capability, old agent rejection and clustered selection tests before relay changes.
```ts
expect(verifyTicket(ticket, secret).bddProfile).toEqual({id:operatorId,revision});
expect(await availableOnOldAgent(ticket)).toMatchObject({available:false});
```
- [ ] Publish public BDD profiles in hello/directory; signed tickets and open messages bind exact profile revision and organization. Register profile sessions in same concurrency/drain/revoke semantics as existing agents.
- [ ] Agent loads manifest only at startup, advertises validated public profiles and dispatches BDD sessions. Upgrade distribution with Cucumber/TS loader dependencies; make unsupported profiles fail before module loading.
- [ ] Dispatch BDD before manual/browser branch, once per saved scenario/dataset row (not browser matrix); use approved snapshot binding and normalized strict verdict. Include setup/cleanup/retry semantics and abort signals.
- [ ] Normalize results into existing step/report/evidence model, redact variables/credential fields, avoid raw paths/stdout. Verify persisted results and published revision through real agent and cluster tests.

## Task 5: UI import/edit/profiles/results (UI implementer)

**Own:** TestFilesDialog and tests, new BDD editor/profile configuration components and tests, test editor wiring, report BDD evidence component. Root owns locales/docs/E2E.
- [ ] Add failing explicit manual/Cucumber import choice, authorized profile selection and localized preview tests.
```ts
expect(JSON.parse(fetchMock.mock.calls[0][1].body).bdd).toMatchObject({mode:'cucumber',binding:{id:profileId,revision}});
```
- [ ] Implement profile CRUD interface with only advertised choices; source editor/revalidation and mode conversion. Preserve source-selector consistency and immutable metadata when selecting other test identities.
- [ ] Display manual doc strings/tables and normalized Cucumber steps/hooks/failures with escaped text; bounded safe attachment handling. Disable browser step editing when Cucumber-bound.
- [ ] Run client focused tests/typecheck; provide locale key list and required root wiring.

## Task 6: Acceptance, final review and delivery (root)

- [ ] EN/IT guides and agent/operator runbook; EN/IT/FR/DE UI keys. Append Collaudo cases and evidence while preserving historical IDs/results.
- [ ] Add production E2E import/profile/publish/plan/report journey using a genuine Cucumber agent and dedicated PostgreSQL. Verify published source/support revision despite edited draft.
- [ ] Full typecheck/lint/server/client, RLS, application/docs/agent builds, Collaudo and guarded production network. Rerun concurrency-only failures in isolation before diagnosing product behavior.
- [ ] Independent review of parser round-trips, selector isolation, signed profile boundary, process cleanup and persistence redaction; fix proven findings with regressions.
- [ ] Explicit staging, commit/push, create/attach draft PR, verify all actual-head CI checks, mark ready. Preserve primary checkout; no automatic merge.

## Execution ledger

- 2026-10-04: written design approved; authorization includes plan and complete execution through PR without intermediate approvals. Existing feature branch provides requested checkout isolation; preserve baseline untracked files and use primary checkout.
- Contracts checked: Tasks 1/2 share BddTest/import options; Tasks 2/3/4 share agent request/results and profile binding; Tasks 2/5 share profile endpoints/import contract; Tasks 4/5 share normalized report schema. Ownership does not overlap except root integration wiring, which root controls.
- Ruling: implementation uses Cucumber.js 12.9.0 (Node 20 compatible); external Java/.NET command adapter is outside this approved initial implementation. Dedicated organization-owned agent is the executable-code boundary; provided container is operational isolation, not a promise that Node child processes sandbox hostile code.
