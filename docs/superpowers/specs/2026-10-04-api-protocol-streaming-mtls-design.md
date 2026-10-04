# Streaming gRPC, mutual TLS, interactive WebSocket and distributed SOAP descriptions

Date: 2026-10-04. Branch: `codex/api-protocol-streaming-mtls`. Base: merged main `4814a60` (PR #292). Status: approved by the user; implementation complete, final verification and PR delivery underway.

## Intent and acceptance

Complete the existing API tester for services that require streaming gRPC or mutual TLS, WebSocket conversations whose next request depends on a response, and SOAP descriptions split across WSDL/XSD files or expressed as WSDL 2.0. The same saved test must work manually, in a plan, on the server worker and through an authorized local agent. Existing unary gRPC calls, WebSocket send/collect bodies, SOAP imports, approved publishing and version history must keep working.

Configuration belongs to the test and its selected organization environment. Credentials use existing encrypted environment secrets. An organization must not be forced to inherit another organization's certificates or a single installation-wide protocol choice.

## Approaches and choice

1. Recommended: extend the shared native protocol implementation, add a bounded declarative conversation format, and resolve uploaded SOAP document bundles without network access. This preserves one execution implementation for server and agent and supports intranet descriptions provided by the operator.
2. Separate runner implementations or an external service: more deployment and credential boundaries, with different server/agent behavior to maintain.
3. Download WSDL imports automatically from arbitrary URLs: convenient for public descriptions, but would require a separately designed authenticated discovery flow, including local-agent routing and destination policy. Use explicit uploaded documents in this delivery.

## gRPC execution

Read the selected method's requestStream/responseStream flags from the proto definition. Support unary, server-streaming, client-streaming and bidirectional-streaming methods. The proto is authoritative; an optional explicit UI choice must match it. Do not infer streaming from the request message's field names.

Unary and server-streaming accept a single JSON request message. Client-streaming and bidirectional methods accept an explicit stream plan containing an ordered request-message array, or conversation steps. Ordinary request messages, including messages with fields named `messages` or `steps`, remain ordinary messages for unary/server-streaming calls. Client streams half-close after the last request; response streams settle only after their terminal gRPC status. Honor write backpressure.

Unary and client-streaming keep the single-response body shape. Server-streaming and bidirectional return `{messages, last, count, captures}` with messages in arrival order, so existing JSON-path assertions/extractions can read `messages[0].id`, `last.id` or `count`. Preserve initial metadata and terminal status/trailers. A remote gRPC error remains a protocol response on which assertions can operate; a malformed plan, resource-limit failure or missing local capture is an execution failure.

Use one overall deadline, explicit cancellation, and deterministic cleanup of calls, clients, event handlers and temporary proto files. Configure timeout up to 60 seconds, response-message count and aggregate byte limits within hard bounds. Suggested defaults: 30 seconds, 100 received messages, 1 MiB aggregate data; hard ceilings: 60 seconds, 1,000 messages and 8 MiB. Include queued messages in these limits. Never declare a truncated stream successful or wait indefinitely for a server that does not end its stream.

## TLS and mTLS

Add an optional typed `protocolConfig` JSON field to API tests through the next additive migration. Include it in runtime validation, manual execution, save/load, copies, API version snapshots, approved publication, plan execution and test-bundle export/import.

The gRPC section supports a trusted root CA, client certificate chain and client private key, supplied as exact references to existing environment secrets such as `{{secret_grpc_ca}}`. An optional private-key passphrase is also a secret reference. Resolve these only on the server against the selected environment and organization; saved tests, previews, versions and exported bundles contain references. Certificate/key must be supplied together and match. Reject missing references, invalid PEM and oversized material before attempting a connection. A TLS configuration is valid only for `grpcs://`; use normal verified TLS when custom trust/client credentials are absent.

Keep hostname verification and certificate validation mandatory. Do not expose an insecure TLS toggle or automatic plaintext fallback. Decrypt an encrypted PEM private key in memory if a passphrase is configured. Errors and persisted reports must not echo resolved keys, passphrases or certificate values. Agent requests carry only the necessary resolved material through the existing authenticated session; never store it in relay tickets or log the request body.

Keep the mandatory egress proxy and original target hostname/SNI when the server uses CONNECT. Custom trust must not accidentally authenticate the proxy as the destination. Local agents retain their own destination-policy boundary, as in the existing deployment.

## WebSocket and bidirectional conversations

Retain the existing line-based body and `{send, waitMs, until}` collection format. Add a strict `{steps: [...]}` conversation format, with a maximum of 100 steps, using:

- `send`: a text/JSON message;
- `receive`: wait for the next message or a declared JSON-path/text condition, within a per-step timeout and the overall deadline;
- `capture`: extract a JSON-path/text value from the response accepted by the preceding receive;
- `end`: half-close the request stream for gRPC bidirectional calls; WebSocket closes on completion.

Later sends interpolate `{{capture.name}}` only when the send executes. Resolve environment variables separately; do not substitute the entire plan or reject future captures as unresolved before their receive step. Captures are local to this conversation, cannot override secret/environment variables, and are returned separately for optional final extractions.

Use a bounded inbound queue so an immediate response cannot race with the following receive registration. A receive condition consumes messages in order until one matches; preserve all bounded received messages in the transcript. A missing capture/path, unmatched condition, early close while steps remain, invalid step order, count/byte limit, or timeout fails the test with its step index. Completion records a bounded transcript; existing assertions/extractions still run against the final response. Reuse existing history/result secret redaction for captured and substituted values.

Provide an editor with ordered send/receive/capture steps, JSON editing for advanced plans, and clear validation feedback. Show stream mode and transcript/captures in the API tester. Persist the plan as the request body, preserving legacy bodies unchanged.

## Agent compatibility

Extend the shared agent protocol types, request validation, capabilities and relay selection. Advertise advanced protocol support explicitly. Pass required capabilities in signed tickets and cluster directory selection; reject incompatible older agents before opening a target connection. Older agents continue to execute existing unary/send-collect tests. Do not silently drop TLS configuration or advanced steps when a request reaches an older agent.

Execute the shared protocol implementation through `scripts/agent-api-session.ts`, with the same validation, deadlines, limits and cancellation behavior as the server. Ensure session lifetime covers the bounded request and cleanup. Preserve organization/pool isolation and avoid putting certificate material in tickets or agent-directory records.

## SOAP import

Extend the current preview/import API and dialog to accept a root WSDL and additional named WSDL/XSD documents. Keep the single-content import contract. Permit editable logical paths/URIs for matching referenced documents, including absolute references whose content the user supplies. Preserve relative paths from a directory upload; individual file uploads use explicitly editable names. No uploaded file is executed or written to a server filesystem path.

Resolve WSDL 1.1 imports, WSDL 2.0 imports/includes, and XSD imports/includes by normalized logical location, namespace and component name. Support embedded schemas as well. Resolve QNames with their namespace instead of matching only local names. Validate namespace expectations, missing documents and ambiguous/conflicting definitions. Bound the bundle to 32 documents, 10 MiB total and depth 10, and detect import cycles without recursive expansion. Reject DOCTYPE/entity declarations and never perform network or local-file reads from an import.

For WSDL 1.1, preserve SOAP 1.1/1.2 document-style behavior while using resolved external elements/types and inherited/referenced complex types. For WSDL 2.0, support SOAP HTTP bindings for request/response and one-way input operations, including the declared action and correct envelope namespace. Use explicit preview warnings for unsupported message-exchange patterns, RPC/encoded constructs, schema features or policy extensions instead of claiming full WSDL/XSD compliance. Missing required imported definitions block import rather than creating a misleading empty request.

Expose supported service/binding/endpoint choices in the preview when there are multiple candidates. Retain the legacy default when the user makes no selection. Generate escaped, namespace-correct request skeletons with fill-in placeholders, the chosen SOAP action/content type and response assertions appropriate to the operation. One-way operations must not be assigned the request/response-only `200` expectation. Keep imported source credentials out of generated tests and environment suggestions.

## Files and delivery boundaries

- Protocol contracts/executor: `shared/agent-protocol.ts`, new shared plan/config validation, `server/api-network-protocols.ts`, `server/api-test-runner.ts` and focused protocol fixtures.
- Persistence/integration: `shared/schema.ts`, next migration/journal, `server/routes.ts`, `server/test-execution-service.ts`, typed API versioning/publishing and `server/test-bundle.ts`.
- Agents: `shared/agents.ts`, credentials/relay/directory/protocol modules and `scripts/agent-api-session.ts`/`wfm-agent.ts`.
- SOAP: `server/wsdl-import.ts`, `server/api-import.ts`, import route and `ImportApiTestsDialog.tsx`.
- UI/delivery: API tester components, all four locale files, EN/IT API/operator guides, additive Collaudo cases and production-installation E2E coverage.

## Verification required before PR readiness

Start with failing contract/behavior tests, then implement the smallest change that satisfies them. Use real local gRPC services for all four RPC kinds, terminal errors, slow/never-ending streams, cancellation and backpressure. A private test CA and TLS server must prove valid mTLS, absent/wrong client identity, wrong root/hostname and secret isolation. Verify native execution and authenticated agent execution, including rejection of old capabilities and cluster selection.

Use a real WebSocket challenge service: receive token, capture token, send dependent message, receive confirmation. Cover immediate replies, unrelated frames, malformed steps, closed sockets, unresolved captures, deadlines and bounded transcripts. Verify final assertions and extraction reuse.

Use WSDL 1.1/2.0 fixtures with nested external XSD/WSDL, reused local names across namespaces, includes, missing/duplicate resources, cycles, unsupported constructs and multiple endpoints. Preview/import must agree and preserve old OpenAPI/Postman and single-WSDL behavior.

Verify saved/reloaded/versioned/published/bundled configuration, RLS and environment-secret isolation, logs/history redaction, and authenticated production-browser configuration/execution. Run typecheck, lint, complete server/client suites, PostgreSQL RLS suites, application/docs builds, Collaudo and network checks. Obtain independent review, resolve findings, push and create/attach a PR; mark it ready only after its CI passes. Do not merge automatically or mark unexecuted manual Collaudo cases as passed.

## Primary references

- [gRPC Node basics: all four RPC kinds](https://grpc.io/docs/languages/node/basics/)
- [gRPC authentication and certificate credentials](https://grpc.io/docs/guides/auth/)
- [W3C WSDL 2.0 primer: bindings, import and include](https://www.w3.org/TR/wsdl20-primer/)
