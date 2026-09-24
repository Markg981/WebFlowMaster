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

With Node 20 or later:

```bash
curl -fsSL https://webflowmaster.example.com/cli/wfm-agent.mjs -o wfm-agent.mjs
npm install playwright@<server version> ws
npx playwright install chromium        # and firefox / webkit / msedge if plans use them
WFM_URL=https://webflowmaster.example.com WFM_AGENT_TOKEN=wfa_... node wfm-agent.mjs
```

| Variable | Meaning |
|---|---|
| `WFM_URL` | The WebFlowMaster server |
| `WFM_AGENT_TOKEN` | The token from Settings |
| `WFM_AGENT_MAX_SESSIONS` | Browsers lent at once (default 2, max 16) |

The agent reconnects on its own when the connection drops. It exits with code **2** when the server
refuses its token (revoked) or its protocol version: those do not fix themselves by retrying.
`SIGTERM`/`Ctrl+C` lets the runs using its browsers finish first.

### 3. Point a plan at the pool

In the plan's **Run settings → Run on**, choose *Local agents: &lt;pool&gt;*. The plan's browser
list still applies: each browser is borrowed from the pool.

## Server configuration

| Variable | Where | Meaning |
|---|---|---|
| `AGENT_RELAY_SECRET` | web and worker | Signs the tickets. Defaults to `SESSION_SECRET`; set it explicitly when the worker does not share the web server's session secret. |
| `AGENT_RELAY_URL` | worker | Where the runner reaches the relay. Defaults to `http://127.0.0.1:$PORT`, which is right when the worker runs in the web process. With separate workers, point it at the web server. |

The relay lives in the web process and accepts WebSocket upgrades on `/api/agent/v1/*`: a reverse
proxy in front of it must forward WebSocket upgrades on those paths.

## Limits

- **Playwright versions must match** (major.minor) between agent and server. Settings shows an agent
  that does not match; the Docker image is tagged with the server's version.
- With **several web servers**, agents connect to one of them: `AGENT_RELAY_URL` must lead to the
  instance they are connected to (a single relay host, or sticky routing).
- When no agent of the pool is connected, the browser pass fails with a clear reason
  (`No agent of pool "onprem" is connected`) instead of running somewhere else.

## Security

- The token is stored only as a SHA-256 hash; revoking it (Settings) disconnects the agent at once.
- An agent serves only its own organization, and only runs of plans set to its pool.
- Tickets are HMAC-signed, bound to organization, pool and browser, and expire after 60 seconds.
- Creating and revoking agents are owner-only and recorded in the audit log.
- The agent executes what the plan's steps do inside your network: give pool access to plans you
  would let run from that machine.
