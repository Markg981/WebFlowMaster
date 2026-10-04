# API protocol streaming and mTLS implementation plan

> **For agentic workers:** use superpowers:subagent-driven-development or executing-plans with test-first implementation. User approved the written spec, plan/execution and delivery through PR without further approval on 2026-10-04.

**Goal:** execute streaming/mTLS gRPC and interactive WebSocket tests consistently on workers and agents, and import distributed WSDL 1.1/2.0 descriptions.

**Architecture:** one shared native protocol executor and validated declarative plan; stored configuration contains environment-secret references. Offline WSDL/XSD bundles are resolved by logical location and namespace. Root integrates persistence, versions, relay capabilities and final delivery; independent workers own protocol execution, SOAP import, and UI respectively.

**Tech stack:** TypeScript, Zod, grpc-js/proto-loader, ws, xmldom, Drizzle/PostgreSQL, React, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-api-protocol-streaming-mtls-design.md`.

## Global constraints

- Preserve unary and legacy WebSocket response/body contracts and existing single-file SOAP imports.
- Defaults: 30 seconds, 100 received messages, 1 MiB; hard limits: 60 seconds, 1,000 messages, 8 MiB, 100 conversation steps.
- Persist TLS material as exact `{{secret_name}}` references; resolve only within the selected organization environment. No plaintext private keys in tests, versions, reports or bundles.
- Maintain verified TLS, original target hostname and mandatory proxy. No insecure fallback.
- Uploaded SOAP bundles: 32 documents, total 10 MiB, depth 10, no DOCTYPE/entities, filesystem or remote reads.
- Keep existing untracked cookies, outputs, scratch and temporary user files. No automatic merge or fabricated manual Collaudo results.

## Review focus

- Immediate messages must be queued before receive steps register; never lose a challenge frame.
- Future `{{capture.name}}` references resolve lazily and must not overwrite environment secrets.
- Wrong mTLS identity or old-agent capabilities fail before an unsafe fallback connection.
- SOAP QName collisions and missing dependencies cannot silently generate the wrong request.
- Snapshots, approved publishing and bundle round-trips must carry config references, while transport errors and transcripts redact resolved secrets.

## Shared interfaces

Protocol worker creates `shared/api-protocol-config.ts`:

```ts
export interface ProtocolConfig {
  timeoutMs?: number; maxMessages?: number; maxBytes?: number;
  grpcMode?: 'auto' | 'unary' | 'server_stream' | 'client_stream' | 'bidi';
  tls?: { rootCa?: string; clientCertificate?: string; clientKey?: string; keyPassphrase?: string };
}
// ProtocolConfigSchema validates saved values; TLS values are exact secret references.
// ResolvedProtocolConfig uses the same field names but TLS strings are resolved PEM/passphrase.
// Both executors accept config?: ResolvedProtocolConfig and variables?: Record<string,string>.
```

Conversation body format is `{steps:[...]}` with discriminated `type:'send'|'receive'|'capture'|'end'`. Send has `message:string|JSON`; receive has optional `timeoutMs`, `property` and `equals`; capture has `name`, optional `property` (no property means full response text). Names use `{{capture.name}}`. Client/bidi streaming may also use `{messages:[JSON,...]}`. Protocol worker exports `ConversationPlanSchema` and reusable plan validation from `shared/protocol-conversation.ts`.

SOAP worker extends `importApiDescription(content, options?)` where options has `rootLocation?:string`, `documents?:Array<{location:string;content:string}>`, `endpoint?:string`. Preview returns optional `endpoints:Array<{id:string;label:string;address:string}>` and `selectedEndpoint?:string`. Root content remains the existing required field. SOAP worker owns import route changes in `server/routes/tests.routes.ts`; root waits before editing any overlapping section.

## Task 1 — Native execution and validated contracts (protocol worker)

**Own:** new shared protocol config/conversation modules and tests; `server/api-network-protocols.ts`; new `server/protocol-conversation.ts`/`grpc-protocol.ts` if useful; protocol executor fixture tests. Do not edit shared/schema, runner, relay, UI or central routes.

- [x] Write/run config schema tests: reject plaintext TLS keys, incomplete pairs, excessive bounds and invalid captures. Publish the shared contract after RED/GREEN.
- [x] Write real-service tests before changes for four RPC modes, status/trailers, cancellation, deadline, limits and streamed message order.
- [x] Implement mode dispatch using proto flags, writable drain/half-close, one overall deadline and deterministic cleanup.
- [x] Write mTLS tests with a private CA, correct and wrong client keys, trust/hostname failures; implement credential parsing without insecure options.
- [x] Write immediate WebSocket challenge/capture/dependent-send tests and failure cases; implement the bounded queue and lazy send substitution.
- [x] Preserve existing unary and send/collect tests. Run focused tests and lint. Report exact RED/GREEN evidence and any integration requirements; do not commit others' changes.

Example acceptance assertion:
```ts
expect(response.body).toMatchObject({count: 2, last: {confirmed: true}, captures: {token: 'challenge'}});
expect(response.status).toBe(0); // gRPC terminal status, not response end alone
```

## Task 2 — SOAP bundle import (SOAP worker)

**Own:** `server/wsdl-import.ts`, optional new SOAP resolver/parser modules, `server/api-import.ts` and corresponding tests; import-only section of `server/routes/tests.routes.ts` and import-route tests. No schema, central routes, client or bundle export edits.

- [x] Write failing WSDL 1.1 external XSD and WSDL 2.0 request/response fixtures before implementation.
- [x] Build normalized logical-document registry and QName component indices. Detect namespace conflicts, missing dependencies, cycles and limits; reject DTD/entities in every document.
- [x] Implement SOAP binding/endpoint selection, external types/references/extensions, escaped namespace-correct skeletons and one-way response expectations.
- [x] Add preview/import options and endpoint choices with existing organization/project authorization.
- [x] Verify missing documents, same local names in different namespaces, relative includes, unsafe paths, malformed XML, unsupported constructs and old imports.
- [x] Run importer and route tests/lint; report RED/GREEN and contract changes promptly.

Example acceptance assertion:
```ts
const result = importApiDescription(rootWsdl, {rootLocation:'service.wsdl', documents:[{location:'types/request.xsd',content:externalXsd}]});
expect(result.tests[0].requestBody).toContain('OrderId');
expect(result.tests[0].warnings).not.toContain('missing schema');
```

## Task 3 — API editor and import UI (UI worker)

**Own:** API tester page and new protocol configuration/conversation components and tests; `ImportApiTestsDialog.tsx` and tests. No locales/docs/schema/server edits initially (provide key list to root).

- [x] Write failing tests for config save/load/run, secret-reference-only fields, lazy capture editing and legacy body preservation.
- [x] Implement grpcMode/timeout/limits and TLS reference fields using ProtocolConfigSchema; include protocolConfig in manual run/save/reload.
- [x] Add ordered step editing and raw JSON fallback; show transcript/captures while preserving existing response display.
- [x] Add multi-file/directory bundle selection, editable logical locations/root choice, endpoint selection and unchanged selection/preview flow.
- [x] Test identity/load resets, stale preview invalidation, file limits and accessible controls. Run focused client tests/lint and provide translation keys.

Example acceptance assertion:
```ts
expect(saved.protocolConfig.tls.clientKey).toBe('{{secret_grpc_key}}');
expect(runBody.protocolConfig).toEqual(saved.protocolConfig);
expect(saved.requestBody).toContain('{{capture.token}}');
```

## Task 4 — Persistence, runtime context and agent selection (root)

**Own:** shared/schema, next migration/journal, test-bundle, versioning integration, runner and central routes, execution service; shared/agent-protocol and agents; scripts agent session/entrypoint; relevant tests.

- [x] Add failing config persistence/version/bundle tests. Add nullable JSON protocol_config with schema validation and snapshot allowlist coverage.
- [x] Forward config in manual/plan/approved execution. Resolve TLS secret references from trusted scoped variables; pass variables separately without eager capture substitution.
- [x] Extend request/reply contracts for config/captures and public runtime failure data. Redact resolved TLS and secret variables in errors/history/report output.
- [x] Add failing old-agent compatibility and clustered selection tests. Advertise explicit advanced features, bind required features in signed tickets and reject missing capabilities before target access.
- [x] Forward and validate resolved config in agent session using executor limits; preserve abort and relay lifetime semantics.
- [x] Run focused save/version/bundle/runner/relay tests and architecture checks; inspect every result.

## Task 5 — Docs, acceptance, review and PR (root after integration)

- [x] Translate new UI keys EN/IT/FR/DE and update both API/operator guides; document secret setup, SOAP bundle mapping and limits.
- [x] Add Collaudo cases and evidence without overwriting earlier definitions/results. Add production UI journeys and true PostgreSQL config isolation checks.
- [x] Run check/lint, full server/client suites, RLS, application/docs builds, Collaudo and guarded network checks (local server recording timeout passed on isolated rerun; frozen-head CI remains the final delivery gate).
- [x] Request independent review of security boundaries, stream lifecycle, import resolution and persistence paths. Fix findings with regression tests.
- [ ] Stage feature files explicitly, commit/push, create and attach PR. Verify actual head commit and all CI jobs; mark ready, report actual state and preserve checkout.

## Execution ledger

- 2026-10-04: user approved written spec and authorized completion through PR without further approvals. Branch base verified against merged PR #292. Plan uses independent file ownership and fixed contracts; root owns integration.
- 2026-10-04: integrated all three implementation areas and independent reviews. Regression checks cover gRPC deadlines and terminal status, capability-bound agent tickets, verified mTLS, lazy captures, bounded transcripts, offline SOAP resolution, immutable publishing and redacted persisted reports (including credentials inside whole-message captures).
- 2026-10-04: production installation journeys 9/9, client 483/483, Collaudo 13/13, fresh PostgreSQL RLS 108/108 and guarded network 117 PASS; application/docs builds and standalone agent image verified. Local full server run: 2158 passed, 4 skipped, one recording timeout under concurrent load; isolated recording suite subsequently 8/8 passed. Final PR checks must pass on the frozen head before marking ready. See `collaudo/protocolli/esito-streaming-mtls-2026-10-04.md` and the PR CI jobs for delivery evidence.
