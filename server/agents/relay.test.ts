import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';

/**
 * The agent relay, end to end: the real agent program, the real relay, a real browser.
 *
 * What is worth a test: a runner holding a ticket drives a browser the agent started, including
 * navigating to a page only the agent's side can see; a runner is told in words why there is no
 * browser (no agent in the pool, another organization, another Playwright, a browser that will
 * not start); a forged or expired ticket gets nothing; an agent answers only for sessions it was
 * asked to open; and revoking an agent ends its connection and stops it retrying.
 */

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { AgentRelay, setAgentRelay } = await import('./relay');
const { signTicket, verifyTicket, generateAgentToken, hashAgentToken } = await import('./agent-credentials');
const { connectToAgentBrowser, RUNNER_PLAYWRIGHT_VERSION } = await import('./agent-browser');
const { default: agentsRoutes } = await import('../routes/agents.routes');
const { runAgent } = await import('../../scripts/wfm-agent');

const SECRET = 'relay-test-secret';
const AGENTS: Record<string, { id: string; organizationId: number; pool: string; name: string }> = {
  wfa_onprem: { id: 'agent-onprem', organizationId: 1, pool: 'onprem', name: 'Build box' },
  wfa_revoked: { id: 'agent-revoked', organizationId: 1, pool: 'spare', name: 'Old box' },
};

let server: http.Server;
let base: string;
let relay: InstanceType<typeof AgentRelay>;
let privatePage: http.Server;
let privateUrl: string;
const running: Array<{ stop: () => Promise<void> }> = [];
const env = () => ({ AGENT_RELAY_URL: base, AGENT_RELAY_SECRET: SECRET }) as NodeJS.ProcessEnv;

beforeAll(async () => {
  const app = express();
  app.use(agentsRoutes);
  server = http.createServer(app);
  relay = new AgentRelay({ authenticate: async (token) => (token ? AGENTS[token] ?? null : null), secret: () => SECRET, openTimeoutMs: 20_000 });
  relay.attach(server);
  setAgentRelay(relay);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Stands for the application inside the customer's network. The runner never opens it itself.
  privatePage = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Intranet</title><h1>Only reachable from inside</h1>');
  });
  await new Promise<void>((resolve) => privatePage.listen(0, '127.0.0.1', resolve));
  privateUrl = `http://127.0.0.1:${(privatePage.address() as AddressInfo).port}/`;

  const agent = runAgent({ url: base, token: 'wfa_onprem', maxSessions: 2, browsers: ['chromium'], log: () => {} });
  running.push(agent);
  await agent.ready;
}, 60_000);

afterAll(async () => {
  for (const agent of running) await agent.stop();
  relay.close();
  setAgentRelay(null);
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => privatePage.close(resolve));
});

describe('tickets and tokens', () => {
  it('a ticket is signed, bound to what it names, and short-lived', () => {
    const ticket = signTicket({ organizationId: 1, pool: 'onprem', engine: 'chromium', headless: true, playwrightVersion: '1.61.1' }, SECRET, 1_000);
    expect(verifyTicket(ticket, SECRET, 2_000)).toMatchObject({ organizationId: 1, pool: 'onprem' });
    expect(verifyTicket(ticket, 'another-secret', 2_000)).toEqual({ error: 'bad signature' });
    expect(verifyTicket(ticket, SECRET, 1_000 + 61_000)).toEqual({ error: 'expired ticket' });
    const [payload, signature] = ticket.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), organizationId: 2 })).toString('base64url');
    expect(verifyTicket(`${forged}.${signature}`, SECRET, 2_000)).toEqual({ error: 'bad signature' });
  });

  it('an agent token is random and kept only as its hash', () => {
    const one = generateAgentToken();
    const two = generateAgentToken();
    expect(one.token).toMatch(/^wfa_[A-Za-z0-9_-]{43}$/);
    expect(one.token).not.toBe(two.token);
    expect(one.hash).toBe(hashAgentToken(one.token));
    expect(one.hash).not.toContain(one.token);
    expect(one.token.startsWith(one.prefix)).toBe(true);
  });
});

describe('lending a browser', () => {
  it('lets the runner drive a browser the agent started, to a page on the agent\'s side', async () => {
    expect(relay.isConnected('agent-onprem')).toBe(true);
    const browser = await connectToAgentBrowser({ engine: 'chromium', headless: true, agent: { organizationId: 1, pool: 'onprem' } }, env());
    try {
      const page = await browser.newPage();
      await page.goto(privateUrl);
      expect(await page.title()).toBe('Intranet');
      expect(await page.locator('h1').textContent()).toBe('Only reachable from inside');
      // Screenshots come back through the pipe as they would from a local browser.
      expect((await page.screenshot()).subarray(1, 4).toString()).toBe('PNG');
      expect(relay.sessionsOf('agent-onprem')).toBe(1);
    } finally {
      await browser.close();
    }
    await expect.poll(() => relay.sessionsOf('agent-onprem'), { timeout: 10_000 }).toBe(0);
  }, 60_000);

  it('says in words why there is no browser: another pool, another organization, another Playwright', async () => {
    await expect(
      connectToAgentBrowser({ engine: 'chromium', headless: true, agent: { organizationId: 1, pool: 'lab' } }, env()),
    ).rejects.toThrow('No agent of pool "lab" is connected');
    await expect(
      connectToAgentBrowser({ engine: 'chromium', headless: true, agent: { organizationId: 2, pool: 'onprem' } }, env()),
    ).rejects.toThrow('No agent of pool "onprem" is connected');
    await expect(
      connectToAgentBrowser({ engine: 'firefox', headless: true, agent: { organizationId: 1, pool: 'onprem' } }, env()),
    ).rejects.toThrow('has firefox installed');

    const oldRunner = signTicket({ organizationId: 1, pool: 'onprem', engine: 'chromium', headless: true, playwrightVersion: '1.40.0' }, SECRET);
    expect(relay.availability(oldRunner)).toEqual({
      available: false,
      reason: `The agents of pool "onprem" run Playwright ${RUNNER_PLAYWRIGHT_VERSION}, and this server 1.40.0: they must match. Update the agents.`,
    });
  });

  it('passes on why the agent could not start the browser', async () => {
    await expect(
      connectToAgentBrowser({ engine: 'chromium', channel: 'no-such-channel', headless: true, agent: { organizationId: 1, pool: 'onprem' } }, env()),
    ).rejects.toThrow(/could not start the browser/i);
    await expect.poll(() => relay.sessionsOf('agent-onprem')).toBe(0);
  }, 60_000);
});

describe('what the relay refuses', () => {
  const wsBase = () => base.replace(/^http/, 'ws');
  const refusal = (url: string, headers: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => {
        ws.close();
        reject(new Error('it was let in'));
      });
      ws.on('error', () => {});
    });

  it('a forged ticket, an unknown agent token, and an agent answering a session it was not asked to open', async () => {
    expect(await refusal(`${wsBase()}/api/agent/v1/browser?ticket=forged.ticket`)).toBe(401);
    expect(await refusal(`${wsBase()}/api/agent/v1/connect`, { Authorization: 'Bearer wfa_nobody' })).toBe(401);
    expect(await refusal(`${wsBase()}/api/agent/v1/session/not-a-session`, { Authorization: 'Bearer wfa_onprem' })).toBe(403);
  });

  it('revoking an agent ends its connection and stops it retrying', async () => {
    const onFatal = vi.fn();
    const agent = runAgent({ url: base, token: 'wfa_revoked', maxSessions: 1, browsers: ['chromium'], log: () => {}, onFatal });
    running.push(agent);
    const { agentId } = await agent.ready;
    expect(relay.isConnected(agentId)).toBe(true);

    relay.disconnect(agentId, 'This agent was revoked.');

    await expect.poll(() => onFatal.mock.calls.length).toBe(1);
    expect(onFatal.mock.calls[0][0]).toContain('This agent was revoked.');
    expect(relay.isConnected(agentId)).toBe(false);
  }, 30_000);
});
