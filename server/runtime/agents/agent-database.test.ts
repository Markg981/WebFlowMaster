import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { AGENT_PROTOCOL_VERSION } from '@shared/agents';
import { runAgent } from '../../../scripts/wfm-agent';
import type { SqlSession, SqlSessionFactory } from '../data-setup/sql-session';
import type { DatabaseRunner } from '../database-step';
import { agentDataRunner } from './agent-database';
import { signTicket, verifyTicket } from './agent-credentials';
import { AgentRelay } from './relay';

const secret = 'database-relay-test';
const URL_PG = 'postgres://app:s3cret@db.local:5432/app';
let server: http.Server;
let relay: AgentRelay;
let agent: ReturnType<typeof runAgent>;
let env: NodeJS.ProcessEnv;
const log: string[] = [];
let release: (() => void) | null = null;

const open = vi.fn<SqlSessionFactory>(async (kind) => {
  const session: SqlSession = {
    kind,
    query: async (bound) => {
      log.push(`query ${bound.text}`);
      if (bound.text === 'wait') await new Promise<void>((resolve) => (release = resolve));
      if (bound.text === 'boom') throw new Error('relation "x" does not exist (s3cret)');
      return { columns: ['id', 'at'], rows: [{ id: 7n, at: new Date(0) }], rowCount: 1 };
    },
    begin: async () => void log.push('begin'),
    commit: async () => void log.push('commit'),
    rollback: async () => void log.push('rollback'),
    lock: async (key) => void log.push(`lock ${key}`),
    identity: async () => ({ database: 'app', server: 'db.local' }),
    close: async () => void log.push('close'),
  };
  return session;
});
const run = vi.fn<DatabaseRunner>(async () => ({ columns: ['n'], rows: [{ n: 3n }], rowCount: 1 }));

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        relay.availability(new URL(req.url!, 'http://relay').searchParams.get('ticket')!),
      ),
    );
  });
  relay = new AgentRelay({
    authenticate: async (token) =>
      token === 'wfa_lab' || token === 'wfa_old'
        ? { id: token, organizationId: 1, pool: token === 'wfa_lab' ? 'lab' : 'old', name: token }
        : null,
    secret: () => secret,
  });
  relay.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env = { AGENT_RELAY_URL: base, AGENT_RELAY_SECRET: secret };
  // One browser at most: the database sessions below must not be counted against it.
  agent = runAgent({
    url: base,
    token: 'wfa_lab',
    maxSessions: 1,
    browsers: [],
    log: () => {},
    database: { open, run },
  });
  await agent.ready;
});

afterAll(async () => {
  await agent?.stop();
  relay?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

it('runs a data fixture on the agent: one connection, its transaction, values rebuilt', async () => {
  log.length = 0;
  const data = agentDataRunner({ organizationId: 1, pool: 'lab' }, { env });
  expect(data.where).toBe('agent pool "lab"');
  // The agent's network decides where it can connect, not the server's egress policy.
  expect(await data.vet('postgres', URL_PG)).toEqual({ host: '' });
  const session = await data.openSession('postgres', URL_PG, 5000);
  await session.begin();
  await session.lock('customers', 5000);
  const result = await session.query({ text: 'select 1', values: [], names: [] });
  expect(result.rows).toEqual([{ id: 7n, at: new Date(0) }]);
  expect(await session.identity()).toEqual({ database: 'app', server: 'db.local' });
  await session.commit();
  await session.close();
  expect(open).toHaveBeenCalledWith('postgres', URL_PG, 5000);
  expect(log).toEqual(['begin', 'lock customers', 'query select 1', 'commit', 'close']);
});

it('runs a queryDatabase statement on the agent', async () => {
  const data = agentDataRunner({ organizationId: 1, pool: 'lab' }, { env });
  expect(await data.query('postgres', URL_PG, 'select 3', 5000)).toEqual({
    columns: ['n'],
    rows: [{ n: 3n }],
    rowCount: 1,
  });
  expect(run).toHaveBeenCalledWith('postgres', URL_PG, 'select 3', 5000);
});

it('reports the database error without the password', async () => {
  const data = agentDataRunner({ organizationId: 1, pool: 'lab' }, { env });
  const session = await data.openSession('postgres', URL_PG, 5000);
  try {
    await expect(session.query({ text: 'boom', values: [], names: [] })).rejects.toThrow(
      'relation "x" does not exist (***)',
    );
  } finally {
    await session.close();
  }
});

it('lends database sessions apart from the browsers, and closes them with the run', async () => {
  log.length = 0;
  const controller = new AbortController();
  const data = agentDataRunner(
    { organizationId: 1, pool: 'lab' },
    { env, signal: controller.signal },
  );
  // Three at once on an agent that lends a single browser.
  const sessions = await Promise.all(
    [1, 2, 3].map(() => data.openSession('postgres', URL_PG, 5000)),
  );
  expect(relay.sessionsOf('wfa_lab')).toBe(0);
  const browser = signTicket(
    {
      organizationId: 1,
      pool: 'lab',
      engine: 'chromium',
      headless: true,
      playwrightVersion: '0.0.0',
      apiProtocol: 'grpc',
    },
    secret,
  );
  expect(relay.availability(browser)).toEqual({ available: true });
  const waiting = sessions[0].query({ text: 'wait', values: [], names: [] });
  await vi.waitFor(() => expect(release).not.toBeNull());
  controller.abort();
  await expect(waiting).rejects.toThrow(/stopped with the run/);
  release?.();
  release = null;
  // On the agent the connection went with the socket, so its open transaction rolled back.
  await vi.waitFor(() => expect(log.filter((line) => line === 'close')).toHaveLength(3));
});

it('tells to update the agents when none of the pool can run database scripts', async () => {
  const old = new WebSocket(`${env.AGENT_RELAY_URL}/api/agent/v1/connect`, {
    headers: { Authorization: 'Bearer wfa_old' },
  });
  await new Promise<void>((resolve) => {
    old.on('open', () =>
      old.send(
        JSON.stringify({
          type: 'hello',
          protocol: AGENT_PROTOCOL_VERSION,
          agentVersion: '1.0.0',
          playwrightVersion: '1.0.0',
          hostname: 'before-r3',
          browsers: [],
          apiProtocols: ['grpc', 'websocket'],
          maxSessions: 1,
        }),
      ),
    );
    old.once('message', () => resolve());
  });
  try {
    const data = agentDataRunner({ organizationId: 1, pool: 'old' }, { env, waitForSlotMs: 200 });
    await expect(data.openSession('postgres', URL_PG, 5000)).rejects.toThrow(
      /pool "old" can run database scripts.*Update the agents/,
    );
  } finally {
    old.close();
  }
});

it('accepts a database ticket, and refuses one that also asks for API features', () => {
  const common = {
    organizationId: 1,
    pool: 'lab',
    engine: 'chromium' as const,
    headless: true,
    playwrightVersion: '0.0.0',
    apiProtocol: 'database' as const,
  };
  expect(verifyTicket(signTicket(common, secret), secret)).toMatchObject({
    apiProtocol: 'database',
  });
  expect(
    verifyTicket(signTicket({ ...common, apiFeatures: ['native-protocol-v2'] }, secret), secret),
  ).toHaveProperty('error');
});
