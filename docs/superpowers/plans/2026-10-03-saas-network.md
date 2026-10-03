# Shared SaaS Network Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an enforceable deny-by-default network deployment with operator-authorized domains.

**Architecture:** Separate guarded namespaces restrict API/worker to internal services and an
allowlist proxy. Proxy-aware HTTP, browser and native transports preserve approved execution
without a direct fallback. Agent execution remains governed by the customer's network.

**Tech Stack:** Docker Compose, Linux packet filtering, Squid, Node/undici, Playwright, grpc-js, ws.

**Spec:** `docs/superpowers/specs/2026-10-03-saas-network-design.md`

## Global Constraints

- Optional hardened deployment; normal runtime unchanged without `WFM_EGRESS_PROXY`.
- Exact domains and explicit ports; empty allowlist denies external traffic.
- Both API and worker protected; IPv4 and IPv6, private/metadata and host gateways covered.
- Separate disposable project; never modify Collaudo data, volumes or agents for verification.
- EN/IT documentation and CI gate; no secrets in source, policy logs or build context.

## Review Focus

- Redirect and DNS answers do not bypass destination denial.
- Browser implicit localhost bypass and secondary resources do not escape the proxy.
- Native WebSocket/gRPC and single-connection NTLM keep transport semantics.
- Docker host-gateway reachability and extra inherited networks do not reopen output.
- Invalid proxy/policy and missing secrets fail closed rather than reverting to direct access.

### Task 1: Proxy-aware transports

Files: new `server/egress-proxy.ts` and tests; `outbound-http.ts`, `api-network-protocols.ts`,
browser launch sites, process startup and regression suites.

- [x] Write proxy validation/transport tests and demonstrate failure before implementation.
- [x] Implement opt-in dispatching, native CONNECT agents and forced browser proxy options.
- [x] Run targeted regressions including OAuth/NTLM, native protocols and browser execution.

### Task 2: Independent deployment boundary

Files: `deployment/saas-network/*` owned by the deployment worker.
Consumes: `WFM_EGRESS_PROXY=http://egress:3128`; shipped API/worker bundles.
Produces: standalone Compose, policy generator/validation, guards and repeatable network checks.

- [x] Write invalid-policy/default-deny and deployment-boundary tests.
- [x] Implement mandatory-secret configuration, private stores, guarded namespaces and proxy.
- [x] Prove direct/host/private/metadata denial in an isolated Docker project.

### Task 3: Integration and delivery

Files: package scripts, CI, EN/IT security/installation guides, acceptance evidence.

- [x] Validate the assembled deployment with allowed and denied transport paths.
- [x] Add an appropriate CI gate and document exact setup, policy boundaries and recovery.
- [x] Run typecheck/lint/build/docs/server/client/Collaudo checks and review the final diff.
- [ ] Commit/push/open and attach the PR; verify checks before marking ready.

## Implementation rulings and evidence

- Ruling: add a dedicated ingress bridge to the API guard while keeping OUTPUT default-deny.
  Docker does not publish a namespace's port when all of its networks are internal. The first
  full-product smoke exposed the missing host binding despite a healthy API. The bridge is
  reachable only through the loopback-published port; established responses are permitted,
  while new outbound connections remain filtered. The harness now proves real host ingress
  together with direct-destination denial.
- Review fixes: include proxy dependencies in the standalone agent's image/manual install;
  grant the non-superuser runtime read-only access to the Drizzle migration journal.
- Assembled boundary check: 110 API/worker assertions passed, plus actual HTTP/redirect,
  WebSocket, unary gRPC and Chromium/Firefox/WebKit transports and sanitized proxy logs.
- Full-product manual smoke: migrations and grants exit successfully, API host ingress and
  tenant account registration succeed, and the worker registers with authenticated Redis.
  The same bootstrap is covered by `test:network:production` in CI.
- Final local verification: 208 server files / 2,033 passed / 3 skipped; 452 client tests;
  13 Collaudo tests; 11 policy/readiness tests; typecheck, lint (10 existing warnings), application
  build and documentation build passed. Repeated full-product bootstrap and boundary
  harness both exited successfully, including real loopback ingress.
- CI readiness correction: Compose reported a started worker before BullMQ registered it.
  The production smoke now waits up to 60 seconds for actual queue registration, with tests
  for delayed registration, no registration and a stalled lookup. This changes the acceptance
  probe only; a worker that never becomes ready still fails the gate.
