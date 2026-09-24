import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';

/**
 * The relay with several web servers, end to end: two relay instances sharing a directory, a load
 * balancer in front of them, the real agent program and a real browser.
 *
 * What is worth a test: a runner that reaches the instance without the agent still gets its
 * browser, even when the load balancer sends the agent's second connection to the wrong instance
 * too; an instance that cannot reach the one holding the agent says so; revoking an agent drops it
 * from whichever instance holds it; and an instance that goes away stops being chosen.
 */

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { AgentRelay, RELAY_HOP_HEADER } = await import('./relay');
const { MemoryRelayDirectory } = await import('./relay-directory');
const { signTicket } = await import('./agent-credentials');
const { connectToAgentBrowser, RUNNER_PLAYWRIGHT_VERSION } = await import('./agent-browser');
const { default: agentsRoutes } = await import('../routes/agents.routes');
const { setAgentRelay } = await import('./relay');
const { runAgent } = await import('../../scripts/wfm-agent');
const express = (await import('express')).default;

const SECRET = 'cluster-test-secret';
const tokens = new Map<string, { id: string; organizationId: number; pool: string; name: string }>([
  ['wfa_onprem', { id: 'agent-onprem', organizationId: 1, pool: 'onprem', name: 'Build box' }],
  ['wfa_doomed', { id: 'agent-doomed', organizationId: 1, pool: 'doomed', name: 'To revoke' }],
]);
const authenticate = async (token: string | null) => (token ? tokens.get(token) ?? null : null);

interface Instance {
  relay: InstanceType<typeof AgentRelay>;
  server: http.Server;
  url: string;
}

const directory = new MemoryRelayDirectory();
let a: Instance;
let b: Instance;
let balancer: net.Server;
let balancerUrl: string;
let intranet: http.Server;
let intranetUrl: string;
const running: Array<{ stop: () => Promise<void> }> = [];

async function listen(server: http.Server | net.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function instance(id: string): Promise<Instance> {
  const app = express();
  app.use(agentsRoutes);
  const server = http.createServer(app);
  const url = await listen(server);
  const relay = new AgentRelay({
    authenticate,
    secret: () => SECRET,
    heartbeatMs: 300,
    openTimeoutMs: 20_000,
    cluster: { directory, instanceId: id, url, syncMs: 200 },
  });
  relay.attach(server);
  return { relay, server, url };
}

/**
 * The worst a load balancer can do here: the agent's standing connection goes to B, and the second
 * connection it opens for a browser goes to A. Decided on the request line, so the test is exact.
 */
function worstBalancer(): net.Server {
  return net.createServer((client) => {
    client.once('data', (first) => {
      const toA = first.toString('latin1').startsWith('GET /api/agent/v1/session/');
      const port = Number(new URL(toA ? a.url : b.url).port);
      const upstream = net.connect(port, '127.0.0.1', () => {
        upstream.write(first);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
  });
}

const env = (relayUrl: string) => ({ AGENT_RELAY_URL: relayUrl, AGENT_RELAY_SECRET: SECRET }) as NodeJS.ProcessEnv;

beforeAll(async () => {
  a = await instance('instance-a');
  b = await instance('instance-b');
  // Both instances live in this one process, whose availability route answers for one relay: A's,
  // the instance the runners below ask.
  setAgentRelay(a.relay);
  balancer = worstBalancer();
  balancerUrl = await listen(balancer);
  intranet = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Intranet</title><h1>Behind the agent</h1>');
  });
  intranetUrl = `${await listen(intranet)}/`;

  const agent = runAgent({ url: balancerUrl, token: 'wfa_onprem', maxSessions: 2, browsers: ['chromium'], log: () => {} });
  running.push(agent);
  await agent.ready;
  // A learns of B's agent from the directory, not from the agent.
  for (let tries = 0; !a.relay.isConnected('agent-onprem'); tries++) {
    if (tries > 50) throw new Error('A never learned of the agent B holds');
    await a.relay.sync();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 60_000);

afterAll(async () => {
  for (const agent of running) await agent.stop();
  setAgentRelay(null);
  for (const { relay, server } of [a, b]) {
    relay.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await new Promise((resolve) => balancer.close(resolve));
  await new Promise((resolve) => intranet.close(resolve));
});

describe('several relay instances', () => {
  it('lends a browser held by B to a runner that asked A, with the agent\'s second connection landing on A too', async () => {
    expect(b.relay.sessionsOf('agent-onprem')).toBe(0);
    const browser = await connectToAgentBrowser({ engine: 'chromium', headless: true, agent: { organizationId: 1, pool: 'onprem' } }, env(a.url));
    try {
      const page = await browser.newPage();
      await page.goto(intranetUrl);
      expect(await page.title()).toBe('Intranet');
      expect(b.relay.sessionsOf('agent-onprem')).toBe(1);
      // A knows as much, from the directory.
      await expect.poll(async () => {
        await b.relay.sync();
        await a.relay.sync();
        return a.relay.sessionsOf('agent-onprem');
      }).toBe(1);
    } finally {
      await browser.close();
    }
    await expect.poll(() => b.relay.sessionsOf('agent-onprem'), { timeout: 10_000 }).toBe(0);
  }, 60_000);

  it('answers availability from A about the agents of B, reasons included', async () => {
    const ticket = (pool: string, engine: 'chromium' | 'firefox' = 'chromium') =>
      signTicket({ organizationId: 1, pool, engine, headless: true, playwrightVersion: RUNNER_PLAYWRIGHT_VERSION }, SECRET);
    expect(a.relay.availability(ticket('onprem'))).toEqual({ available: true });
    expect(a.relay.availability(ticket('onprem', 'firefox'))).toEqual({ available: false, reason: 'No agent of pool "onprem" has firefox installed.' });
    expect(a.relay.availability(ticket('lab'))).toMatchObject({ available: false, reason: expect.stringContaining('No agent of pool "lab"') });
  });

  it('does not forward a request that was already forwarded', async () => {
    const ticket = signTicket({ organizationId: 1, pool: 'onprem', engine: 'chromium', headless: true, playwrightVersion: RUNNER_PLAYWRIGHT_VERSION }, SECRET);
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`${a.url.replace('http', 'ws')}/api/agent/v1/browser?ticket=${encodeURIComponent(ticket)}`, {
        headers: { [RELAY_HOP_HEADER]: 'instance-b' },
      });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('it was served')));
      ws.on('error', () => {});
    });
    // A holds no agent of its own, and a hop is served where it lands or refused — never passed on.
    expect(status).toBe(503);
  });

  it('says which instance it could not reach, rather than a bare gateway error', async () => {
    const ghostServer = http.createServer();
    const ghostUrl = await listen(ghostServer);
    await new Promise((resolve) => ghostServer.close(resolve)); // an address nobody answers any more
    await directory.publish(
      {
        id: 'instance-ghost',
        url: ghostUrl,
        agents: [{ id: 'agent-ghost', organizationId: 1, pool: 'ghost', playwrightVersion: RUNNER_PLAYWRIGHT_VERSION, browsers: ['chromium'], maxSessions: 1, activeSessions: 0, draining: false }],
      },
      60_000,
    );
    await a.relay.sync();
    const ticket = signTicket({ organizationId: 1, pool: 'ghost', engine: 'chromium', headless: true, playwrightVersion: RUNNER_PLAYWRIGHT_VERSION }, SECRET);
    const refusal = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const ws = new WebSocket(`${a.url.replace('http', 'ws')}/api/agent/v1/browser?ticket=${encodeURIComponent(ticket)}`);
      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      ws.on('open', () => reject(new Error('it was served')));
      ws.on('error', () => {});
    });
    expect(refusal.status).toBe(502);
    expect(refusal.body).toContain('instance-ghost');
    expect(refusal.body).toContain('AGENT_RELAY_ADVERTISE_URL');
    await directory.withdraw('instance-ghost');
  });

  it('drops a revoked agent from whichever instance holds it, and stops it retrying', async () => {
    const onFatal = vi.fn();
    const agent = runAgent({ url: balancerUrl, token: 'wfa_doomed', maxSessions: 1, browsers: ['chromium'], log: () => {}, onFatal });
    running.push(agent);
    await agent.ready;
    expect(b.relay.isConnected('agent-doomed')).toBe(true);

    // Revoked through A — the instance the owner's request happened to reach — which holds nothing.
    tokens.delete('wfa_doomed');
    a.relay.disconnect('agent-doomed', 'This agent was revoked.');

    await expect.poll(() => onFatal.mock.calls.length, { timeout: 5_000 }).toBe(1);
    expect(onFatal.mock.calls[0][0]).toContain('revoked');
    expect(b.relay.isConnected('agent-doomed')).toBe(false);
  }, 30_000);

  it('stops choosing an instance that went away', async () => {
    const c = await instance('instance-c');
    await directory.publish(
      { id: 'instance-c', url: c.url, agents: [{ id: 'agent-c', organizationId: 1, pool: 'gone', playwrightVersion: RUNNER_PLAYWRIGHT_VERSION, browsers: ['chromium'], maxSessions: 1, activeSessions: 0, draining: false }] },
      60_000,
    );
    await a.relay.sync();
    expect(a.relay.isConnected('agent-c')).toBe(true);

    c.relay.close();
    await new Promise((resolve) => c.server.close(resolve));
    await expect.poll(async () => {
      await a.relay.sync();
      return a.relay.isConnected('agent-c');
    }).toBe(false);
  });
});
