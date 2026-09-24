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
 * asked to open; revoking an agent ends its connection and stops it retrying; and API requests
 * sent through a borrowed browser behave like fetch, from the agent's side.
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
const { AgentHttp } = await import('./agent-fetch');
const { runApiRequest } = await import('../api-test-runner');
const { runPreconditions } = await import('../precondition-runner');

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
  privatePage = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://intranet');
    if (url.pathname === '/api/echo') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': ['session=abc; Path=/', 'theme=dark; Path=/'] });
        res.end(JSON.stringify({ method: req.method, query: url.searchParams.get('q'), body, headers: req.headers }));
      });
      return;
    }
    if (url.pathname === '/api/empty') {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/api/slow') return; // never answers
    if (url.pathname === '/oauth/token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'from-inside', token_type: 'Bearer', expires_in: 60 }));
    }
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
  privatePage.closeAllConnections(); // the request to /api/slow is still open
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

describe('sending API requests from the agent', () => {
  const onprem = { organizationId: 1, pool: 'onprem' };
  const borrow = (agent: { organizationId: number; pool: string }) =>
    connectToAgentBrowser({ engine: 'chromium', headless: true, agent }, env());

  it('answers like fetch: status, headers (repeated ones too), body; and sent by Playwright, not by the runner', async () => {
    const http = new AgentHttp(onprem, borrow);
    try {
      const response = await http.fetch(`${privateUrl}api/echo?q=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Trace': 't-1' },
        body: JSON.stringify({ hello: 'inside' }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.getSetCookie()).toEqual(['session=abc; Path=/', 'theme=dark; Path=/']);
      const echoed = await response.json();
      expect(echoed).toMatchObject({ method: 'POST', query: '1', body: '{"hello":"inside"}' });
      expect(echoed.headers['x-trace']).toBe('t-1');
      // The runner's own fetch says "node"; this one came from the agent's Playwright.
      expect(echoed.headers['user-agent']).toMatch(/Chrome/);

      // One browser for the run, however many requests.
      await http.fetch(`${privateUrl}api/echo`);
      expect(relay.sessionsOf('agent-onprem')).toBe(1);
    } finally {
      await http.close();
    }
    await expect.poll(() => relay.sessionsOf('agent-onprem'), { timeout: 10_000 }).toBe(0);
  }, 60_000);

  it('keeps no cookies between requests, as fetch does not', async () => {
    const http = new AgentHttp(onprem, borrow);
    try {
      await http.fetch(`${privateUrl}api/echo`);
      const second = await (await http.fetch(`${privateUrl}api/echo`)).json();
      expect(second.headers.cookie).toBeUndefined();
      const empty = await http.fetch(`${privateUrl}api/empty`, { method: 'DELETE' });
      expect(empty.status).toBe(204);
      expect(await empty.text()).toBe('');
    } finally {
      await http.close();
    }
  }, 60_000);

  it('stops a request when its caller gives up, as an AbortError', async () => {
    const http = new AgentHttp(onprem, borrow);
    try {
      // While the browser is still being borrowed…
      const early = new AbortController();
      const borrowing = http.fetch(`${privateUrl}api/slow`, { signal: early.signal });
      setTimeout(() => early.abort(), 50);
      await expect(borrowing).rejects.toMatchObject({ name: 'AbortError' });

      // …and while the request is out, with the browser already there.
      await http.fetch(`${privateUrl}api/echo`);
      const late = new AbortController();
      const pending = http.fetch(`${privateUrl}api/slow`, { signal: late.signal });
      setTimeout(() => late.abort(), 500);
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      await http.close();
    }
  }, 60_000);

  it('runs an API test, its OAuth token request and preconditions through the agent', async () => {
    const http = new AgentHttp(onprem, borrow);
    try {
      const result = await runApiRequest(
        {
          method: 'POST',
          url: '{{inside}}api/echo',
          body: { id: '{{id}}' },
          auth: { type: 'oauth2', params: { tokenUrl: '{{inside}}oauth/token', clientId: 'wfm', grantType: 'client_credentials' } } as any,
          assertions: [{ id: 'a', source: 'status_code', comparison: 'equals', targetValue: '201', enabled: true } as any],
          extractions: [{ name: 'auth', source: 'body_json_path', property: 'headers.authorization' } as any],
        },
        { inside: privateUrl, id: '42' },
        http.fetch,
      );
      expect(result.error).toBeUndefined();
      expect(result.passed).toBe(true);
      expect(result.extracted.auth).toBe('Bearer from-inside');

      const pre = await runPreconditions([{ name: 'Seed', method: 'POST', url: `${privateUrl}api/echo`, requestBody: { a: 1 } } as any], {}, http.fetch);
      expect(pre).toMatchObject({ ok: true, ranCount: 1 });
    } finally {
      await http.close();
    }
  }, 60_000);

  it('fails the request with the reason when the pool has no agent', async () => {
    const http = new AgentHttp({ organizationId: 1, pool: 'lab' }, borrow);
    await expect(http.fetch(`${privateUrl}api/echo`)).rejects.toThrow(
      'Could not send the request from agent pool "lab": No agent of pool "lab" is connected',
    );
    const result = await runApiRequest({ method: 'GET', url: `${privateUrl}api/echo` }, {}, http.fetch);
    expect(result.passed).toBe(false);
    expect(result.error).toContain('No agent of pool "lab" is connected');
    await http.close();
  });
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
