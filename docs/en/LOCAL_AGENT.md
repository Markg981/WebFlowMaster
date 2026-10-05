# Local agents

A local agent runs **inside your network** and lends its browsers to WebFlowMaster. Plans set to
run on the agent's pool open their pages from that machine, so they can test applications the
WebFlowMaster server cannot reach: an intranet, a staging environment behind a VPN, `localhost`
on a developer's laptop.

The agent **only connects out**, over HTTPS/WSS to the server. It needs no inbound port, no VPN
and no firewall change beyond outbound access to the server.

## How it works

```
 your network                                   WebFlowMaster
┌───────────────────────────┐        WSS        ┌──────────────────────────────┐
│ wfm-agent                 │ ───── control ──▶ │ relay (web server)           │
│  └─ browser (Playwright)  │ ───── session ──▶ │   ▲                          │
│        │                  │                   │   │ ticket (60 s, signed)    │
│        ▼                  │                   │ runner / worker              │
│  app under test           │                   │  runs the plan's steps       │
└───────────────────────────┘                   └──────────────────────────────┘
```

1. The agent holds a control connection to the server and says which browsers it has.
2. When a run of a plan set to its pool starts, the runner asks the relay for a browser with a
   short-lived signed ticket. The relay picks the least busy connected agent of that pool in the
   same organization.
3. The agent starts the browser locally and opens a second outbound connection. The relay pipes
   the Playwright protocol between the runner and that browser.
4. The runner drives it as it would its own: steps, screenshots, video, trace, HAR, accessibility
   checks all work unchanged, and the report names the pool (`chromium on agent pool "onprem"`).
5. The run's **API tests, API preconditions and OAuth token requests** are sent from the agent
   too, through the same kind of borrowed browser (Playwright's request API runs where the browser
   runs). Each request starts with no cookies, exactly as from the server. The browser for them is
   borrowed on the first request, so a plan without API calls never asks for one. The agent needs
   Chromium installed for this, whatever browsers the plan's UI tests use.

## gRPC and WebSocket inside the private network

Plans assigned to a local pool execute unary and streaming gRPC calls and WebSocket exchanges on the agent,
including TLS addresses (`grpcs://`, `wss://`). Assertions and captures still run on the server.
Native sessions need no installed browser; HTTP and OAuth token requests still need Chromium.
Sessions share `WFM_AGENT_MAX_SESSIONS`; the run returns an idle HTTP browser before opening a
native session, including after OAuth token acquisition. Closing the run transport cancels its active API call.

Use agent **1.2.0 or later**: download the script again and install the packages in the setup
command below, or rebuild and restart the Docker agent. Existing v1 agents still serve browsers
and HTTP; a pool without native protocol support fails explicitly and asks you to update it.
The runner never falls back to making these calls from the server's network.

Streaming, mutual TLS and ordered conversations require `native-protocol-v2`. Older native
agents can still serve legacy unary/WebSocket calls, but cannot receive an advanced ticket.
TLS identities come from the test's organization environment; resolved fields travel only
inside the authenticated native session, while tickets and directory records contain feature names.

## Set up

### 1. Create the agent (owners)

**Settings → Local agents**: give it a name and a pool (for example `onprem`, `lab`,
`marco-laptop`). The token (`wfa_…`) is shown **once**, together with the commands to run.
Several agents in the same pool share the load.

### 2. Run it

With Docker (recommended; browsers included):

```bash
docker build -f Dockerfile.agent -t webflowmaster-agent .
docker run -d --restart unless-stopped \
  -e WFM_URL=https://webflowmaster.example.com \
  -e WFM_AGENT_TOKEN=wfa_... \
  webflowmaster-agent
```

With Node 20.18.1 or later:

```bash
curl -fsSL https://webflowmaster.example.com/cli/wfm-agent.mjs -o wfm-agent.mjs
curl -fsSL https://webflowmaster.example.com/cli/wfm-bdd-child.mjs -o wfm-bdd-child.mjs
npm install playwright@<server version> ws @grpc/grpc-js @grpc/proto-loader undici@^7 https-proxy-agent@^7 zod@^3 @cucumber/cucumber@12.9.0 @cucumber/gherkin@38.0.0 @cucumber/messages@32.3.1 tsx@^4
npx playwright install chromium        # and firefox / webkit / msedge if plans use them
WFM_URL=https://webflowmaster.example.com WFM_AGENT_TOKEN=wfa_... node wfm-agent.mjs
```

| Variable | Meaning |
|---|---|
| `WFM_URL` | The WebFlowMaster server |
| `WFM_AGENT_TOKEN` | The token from Settings |
| `WFM_AGENT_MAX_SESSIONS` | Browser and native API sessions at once (default 2, max 16) |

The agent reconnects on its own when the connection drops. It exits with code **2** when the server
refuses its token (revoked) or its protocol version: those do not fix themselves by retrying.
`SIGTERM`/`Ctrl+C` lets the runs using its browsers finish first.

### 3. Point a plan at the pool

An agent also reaches an **Appium** server on its machine or network, for mobile app tests on
emulators and phones: see [local Appium](./guide/mobile-apps#local-appium).

In the plan's **Run settings → Run on**, choose *Local agents: &lt;pool&gt;*. The plan's browser
list still applies: each browser is borrowed from the pool.

## Server configuration

| Variable | Where | Meaning |
|---|---|---|
| `AGENT_RELAY_SECRET` | web and worker | Signs the tickets. Defaults to `SESSION_SECRET`; set it explicitly when the worker does not share the web server's session secret. |
| `AGENT_RELAY_URL` | worker | Where the runner reaches the relay. Defaults to `http://127.0.0.1:$PORT`, which is right when the worker runs in the web process. With separate workers, point it at the web server (or its load balancer). |
| `AGENT_RELAY_ADVERTISE_URL` | web, with several web servers | This web server's own address as the other web servers reach it (pod IP, container name — not the load balancer). Setting it turns on the shared directory in Redis. |

The relay lives in the web process and accepts WebSocket upgrades on `/api/agent/v1/*`: a reverse
proxy in front of it must forward WebSocket upgrades on those paths.

### Several web servers

Each web server runs its own relay, and an agent is connected to whichever one the load balancer
gave it. With `AGENT_RELAY_ADVERTISE_URL` set on every web server, they publish their agents to
Redis (the one the queue already uses) every few seconds. A request that lands on a server without
the agent it needs — the runner's for a browser, or the agent's own second connection — is passed
to the server that has it, directly at its advertised address. No sticky sessions are needed, and
the web servers must be able to reach each other on those addresses.

A revoked agent is dropped at once by the server holding it if the owner's request reached that
server, and otherwise at its next heartbeat (within 20 seconds). A server that stops withdraws its
entry; one that crashes stops being chosen within 15 seconds, and meanwhile a runner sent to it
gets a refusal naming it.

## Limits

- **Playwright versions must match** (major.minor) between agent and server. Settings shows an agent
  that does not match; the Docker image is tagged with the server's version.
- When no agent of the pool is connected, the browser pass fails with a clear reason
  (`No agent of pool "onprem" is connected`) instead of running somewhere else.

## Dedicated Cucumber support

Agent **1.3.0** also accepts signed BDD sessions for operator-advertised profiles. Provision a
separate organization-owned pool for support code; shared SaaS workers never import it. Keep
`wfm-bdd-child.mjs` beside `wfm-agent.mjs`, install the support project's dependencies and set
`WFM_BDD_PROFILES` to an operator manifest. The sample, locked JS/TS projects and isolated container
are in `deployment/bdd-agent/`.

The owner selects the advertised pool/profile/revision in BDD execution profiles; bindings may
cover the organization or one project. A different pool/operator profile requires a new binding.
Changing the support revision invalidates tests still pinned to the former revision. Feature
source, scenario/Examples selectors and the binding participate in publishing/history. See
[Gherkin/Cucumber files](../gherkin-files).

Support globs stay inside the approved project. A profile may enable the `tsx` loader and explicitly
allow operator environment names; agent/relay tokens, database/Redis credentials and runtime-control
variables cannot be inherited. Run variables are World parameters. Use host/container network
policies for destinations, read-only support mounts, a non-root account and writable bounded `/tmp`.

HTTP preconditions and cleanup use Chromium's request API on the same dedicated pool. Install
Chromium on agents used for those requests; a pure Cucumber scenario does not need a browser.
The HTTP session is released before Cucumber starts, so a single-slot agent is supported.

## Security

- The token is stored only as a SHA-256 hash; revoking it (Settings) disconnects the agent at once.
- An agent serves only its own organization, through its plan pool or an authorized BDD binding.
- Tickets are HMAC-signed, bound to organization/pool and browser or exact BDD profile/revision,
  and expire after 60 seconds.
- Creating and revoking agents are owner-only and recorded in the audit log.
- The agent executes what the plan's steps do inside your network: give pool access to plans you
  would let run from that machine.
