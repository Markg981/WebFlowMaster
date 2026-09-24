/**
 * wfm-agent — lends this machine's browsers to WebFlowMaster runs.
 *
 * Start it inside the network where the application under test lives:
 *
 *   WFM_URL=https://webflowmaster.example.com WFM_AGENT_TOKEN=wfa_… node wfm-agent.mjs
 *
 * It opens connections outward to the server, and only outward: no inbound port, no VPN. When a
 * run of a plan set to this agent's pool starts, the server asks for a browser. The agent starts
 * one here and lends it over a second outbound connection. The run drives it from the server as it
 * would its own, so the pages it opens are opened from this machine and see what this machine sees.
 *
 * Needs Node 20+, the npm packages `playwright` (the same major.minor as the server's) and `ws`,
 * and the browsers themselves (`npx playwright install chromium`). The Docker image built from
 * Dockerfile.agent has all of it.
 *
 * Exits 0 when stopped (SIGINT/SIGTERM, after the browsers it is lending are done), and 2 when the
 * server refuses its token or its version: those do not fix themselves by retrying.
 */

import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import type { BrowserServer } from 'playwright';

export const AGENT_VERSION = '1.0.0';
/** Kept in step with shared/agents.ts, written out because this script is shipped on its own. */
const PROTOCOL = 1;
const PATHS = { connect: '/api/agent/v1/connect', session: '/api/agent/v1/session/' };
type Engine = 'chromium' | 'firefox' | 'webkit';

export interface AgentOptions {
  url: string;
  token: string;
  maxSessions: number;
  /** Replaces the browsers found installed; for tests and for machines that should lend fewer. */
  browsers?: Engine[];
  log?: (line: string) => void;
  /** Called when the server refuses the token or the version; the process exits on it. */
  onFatal?: (reason: string) => void;
}

export interface RunningAgent {
  /** Resolves once the server has welcomed this agent the first time. */
  ready: Promise<{ agentId: string; name: string; pool: string }>;
  /** Stops taking browsers, waits for the ones lent to be returned, and disconnects. */
  stop: () => Promise<void>;
  activeSessions: () => number;
}

function playwrightVersion(): string {
  return createRequire(import.meta.url)('playwright/package.json').version;
}

async function installedBrowsers(): Promise<Engine[]> {
  const playwright = await import('playwright');
  return (['chromium', 'firefox', 'webkit'] as Engine[]).filter((engine) => {
    try {
      return fs.existsSync(playwright[engine].executablePath());
    } catch {
      return false;
    }
  });
}

const toWs = (url: string) => url.replace(/\/+$/, '').replace(/^http/i, 'ws');

export function runAgent(options: AgentOptions): RunningAgent {
  const log = options.log ?? ((line: string) => console.log(`[wfm-agent] ${line}`));
  const base = toWs(options.url);
  const headers = { Authorization: `Bearer ${options.token}` };
  const sessions = new Map<string, { server?: BrowserServer; sockets: WebSocket[] }>();
  let control: WebSocket | null = null;
  let stopping = false;
  let attempt = 0;
  let welcomed: (value: { agentId: string; name: string; pool: string }) => void = () => {};
  const ready = new Promise<{ agentId: string; name: string; pool: string }>((resolve) => {
    welcomed = resolve;
  });

  const fatal = (reason: string) => {
    stopping = true;
    log(reason);
    control?.close();
    options.onFatal?.(reason);
  };

  async function lend(sessionId: string, engine: Engine, channel: string | undefined, headless: boolean) {
    const entry: { server?: BrowserServer; sockets: WebSocket[] } = { sockets: [] };
    sessions.set(sessionId, entry);
    const finish = async () => {
      if (!sessions.delete(sessionId)) return;
      for (const socket of entry.sockets) socket.terminate();
      await entry.server?.close().catch(() => {});
      log(`Browser ${sessionId.slice(0, 8)} returned (${sessions.size} lent).`);
    };
    try {
      const playwright = await import('playwright');
      entry.server = await playwright[engine].launchServer({ headless, ...(channel ? { channel } : {}) });
    } catch (error) {
      sessions.delete(sessionId);
      const message = (error as Error)?.message?.split('\n')[0] ?? String(error);
      control?.send(JSON.stringify({ type: 'open_failed', sessionId, error: message }));
      log(`Could not start ${engine} for a run: ${message}`);
      return;
    }

    const local = new WebSocket(entry.server.wsEndpoint(), { maxPayload: 256 * 1024 * 1024 });
    const remote = new WebSocket(`${base}${PATHS.session}${sessionId}`, { headers, maxPayload: 256 * 1024 * 1024 });
    entry.sockets.push(local, remote);
    // Each side may start talking before the other is open; held until it is.
    const pending: Record<'toLocal' | 'toRemote', Array<{ data: WebSocket.RawData; isBinary: boolean }>> = { toLocal: [], toRemote: [] };
    const pipe = (from: WebSocket, to: WebSocket, queue: Array<{ data: WebSocket.RawData; isBinary: boolean }>) => {
      from.on('message', (data, isBinary) => {
        if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
        else queue.push({ data, isBinary });
      });
      to.on('open', () => {
        for (const { data, isBinary } of queue.splice(0)) to.send(data, { binary: isBinary });
      });
    };
    pipe(remote, local, pending.toLocal);
    pipe(local, remote, pending.toRemote);
    for (const socket of [local, remote]) {
      socket.on('close', () => void finish());
      socket.on('error', () => void finish());
    }
    log(`Lent ${engine}${headless ? '' : ' (headed)'} to a run (${sessions.size} lent).`);
  }

  function connect() {
    if (stopping) return;
    const ws = new WebSocket(`${base}${PATHS.connect}`, { headers });
    control = ws;

    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 401) return fatal('The server refused this agent\'s token: it is unknown or was revoked. Create a new agent in Settings → Agents.');
      log(`The server answered ${res.statusCode}; trying again.`);
      ws.terminate();
    });
    ws.on('open', async () => {
      attempt = 0;
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL,
          agentVersion: AGENT_VERSION,
          playwrightVersion: playwrightVersion(),
          hostname: os.hostname(),
          browsers: options.browsers ?? (await installedBrowsers()),
          maxSessions: options.maxSessions,
        }),
      );
    });
    ws.on('message', (raw) => {
      let message: any;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        log(`Connected as "${message.name}" in pool "${message.pool}".`);
        welcomed({ agentId: message.agentId, name: message.name, pool: message.pool });
      } else if (message.type === 'refused') {
        fatal(`The server refused this agent: ${message.reason}`);
      } else if (message.type === 'open') {
        if (stopping) {
          ws.send(JSON.stringify({ type: 'open_failed', sessionId: message.sessionId, error: 'The agent is stopping.' }));
          return;
        }
        void lend(message.sessionId, message.engine, message.channel, message.headless !== false);
      }
    });
    ws.on('error', () => {
      /* 'close' follows and reconnects. */
    });
    ws.on('close', () => {
      if (stopping) return;
      // Backs off to half a minute: a server being deployed comes back, and a thousand agents
      // retrying every second would be what stops it.
      const delay = Math.min(30_000, 500 * 2 ** attempt++);
      log(`Disconnected; reconnecting in ${Math.round(delay / 1000)}s.`);
      setTimeout(connect, delay).unref?.();
    });
  }

  connect();

  return {
    ready,
    activeSessions: () => sessions.size,
    stop: async () => {
      stopping = true;
      if (control?.readyState === WebSocket.OPEN) control.send(JSON.stringify({ type: 'draining' }));
      // The runs using a browser from here finish; nothing new is taken.
      while (sessions.size > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      control?.close();
    },
  };
}

/* c8 ignore start — the process wrapper. */
export function main(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.WFM_URL;
  const token = env.WFM_AGENT_TOKEN;
  if (!url || !token) {
    console.error('Set WFM_URL to the server and WFM_AGENT_TOKEN to the token from Settings → Local agents.');
    process.exit(2);
  }
  const maxSessions = Math.max(1, Math.min(Number(env.WFM_AGENT_MAX_SESSIONS) || 2, 16));
  const agent = runAgent({ url, token, maxSessions, onFatal: () => process.exit(2) });
  let stopping = false;
  const stop = () => {
    if (stopping) return process.exit(1);
    stopping = true;
    console.log('[wfm-agent] Stopping: letting the runs using a browser from here finish. Press Ctrl+C again to quit now.');
    void agent.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && /wfm-agent(\.m?[tj]s)?$/.test(process.argv[1])) main();
/* c8 ignore stop */
