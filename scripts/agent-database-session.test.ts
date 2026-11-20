import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AgentDatabaseCall } from '../shared/agent-protocol';
import type { SqlSession, SqlSessionFactory } from '../server/runtime/data-setup/sql-session';
import type { DatabaseRunner } from '../server/runtime/database-step';
import { decodeDatabaseValue } from '../server/runtime/agents/database-wire';
import { invalidDatabaseCall, serveDatabaseSession } from './agent-database-session';

const URL_PG = 'postgres://app:s3cret@db.local:5432/app';

function fakeSession(log: string[]): SqlSession {
  return {
    kind: 'postgres',
    query: async (bound) => {
      log.push(`query ${bound.text} ${JSON.stringify(bound.values)}`);
      if (bound.text === 'boom') throw new Error('password authentication failed: s3cret');
      return { columns: ['n', 'at'], rows: [{ n: 1n, at: new Date(0) }], rowCount: 1 };
    },
    begin: async () => void log.push('begin'),
    commit: async () => void log.push('commit'),
    rollback: async () => void log.push('rollback'),
    lock: async (key) => void log.push(`lock ${key}`),
    identity: async () => ({ database: 'app', server: 'db.local' }),
    close: async () => void log.push('close'),
  };
}

let wss: WebSocketServer | undefined;
afterEach(async () => {
  wss?.clients.forEach((ws) => ws.terminate());
  await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
  wss = undefined;
});

async function serve(open: SqlSessionFactory, run?: DatabaseRunner) {
  const done = vi.fn();
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss!.on('listening', resolve));
  wss.on('connection', (ws) => serveDatabaseSession(ws, done, open, run));
  const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
  await new Promise<void>((resolve) => client.once('open', resolve));
  const replies = new Map<number, { result?: unknown; error?: string }>();
  const waiters = new Map<number, () => void>();
  client.on('message', (raw) => {
    const reply = JSON.parse(raw.toString());
    replies.set(reply.id, reply);
    waiters.get(reply.id)?.();
  });
  let id = 0;
  const call = (body: Record<string, unknown>) => {
    const next = ++id;
    client.send(JSON.stringify({ ...body, id: next }));
    return new Promise<{ result?: unknown; error?: string }>((resolve) =>
      waiters.set(next, () => resolve(replies.get(next)!)),
    );
  };
  return { client, call, done };
}

describe('invalidDatabaseCall', () => {
  it('opens only an address of the dialect named, within the time limit', () => {
    expect(
      invalidDatabaseCall(
        { id: 1, op: 'open', kind: 'postgres', url: URL_PG, timeoutMs: 1000 },
        false,
      ),
    ).toBeNull();
    expect(
      invalidDatabaseCall(
        { id: 1, op: 'open', kind: 'mysql', url: URL_PG, timeoutMs: 1000 },
        false,
      ),
    ).toMatch(/dialect/);
    expect(
      invalidDatabaseCall(
        { id: 1, op: 'open', kind: 'postgres', url: URL_PG, timeoutMs: 10 * 60_000 },
        false,
      ),
    ).toMatch(/timeout/);
    expect(
      invalidDatabaseCall(
        { id: 1, op: 'open', kind: 'postgres', url: URL_PG, timeoutMs: 1000 },
        true,
      ),
    ).toMatch(/open already/);
  });

  it('refuses statements before the session is open, too large or with values a fixture cannot have', () => {
    const query = (values: unknown[], text = 'select 1') =>
      ({ id: 2, op: 'query', sql: { text, values, names: [] } }) as AgentDatabaseCall;
    expect(invalidDatabaseCall(query([]), false)).toMatch(/not open/);
    expect(invalidDatabaseCall(query(['a', 1, true, null]), true)).toBeNull();
    expect(invalidDatabaseCall(query([{ a: 1 }]), true)).toMatch(/not text/);
    expect(invalidDatabaseCall(query(new Array(2101).fill(1)), true)).toMatch(/2100/);
    expect(invalidDatabaseCall(query([], 'x'.repeat(1024 * 1024 + 1)), true)).toMatch(/longer/);
    expect(invalidDatabaseCall({ id: 3, op: 'lock', key: '', timeoutMs: 1000 }, true)).toMatch(
      /lock key/,
    );
    expect(
      invalidDatabaseCall({ id: 4, op: 'drop' } as unknown as AgentDatabaseCall, true),
    ).toMatch(/Unknown/);
  });
});

describe('serveDatabaseSession', () => {
  it('runs the calls in order on one connection and encodes what JSON cannot carry', async () => {
    const log: string[] = [];
    const open = vi.fn<SqlSessionFactory>(async () => fakeSession(log));
    const { call, client, done } = await serve(open);
    expect(await call({ op: 'open', kind: 'postgres', url: URL_PG, timeoutMs: 1000 })).toEqual({
      id: 1,
      result: null,
    });
    const replies = await Promise.all([
      call({ op: 'begin' }),
      call({ op: 'lock', key: 'customers', timeoutMs: 1000 }),
      call({ op: 'query', sql: { text: 'select $1', values: ['x'], names: ['p'] } }),
      call({ op: 'identity' }),
      call({ op: 'commit' }),
    ]);
    expect(decodeDatabaseValue(replies[2].result)).toEqual({
      columns: ['n', 'at'],
      rows: [{ n: 1n, at: new Date(0) }],
      rowCount: 1,
    });
    expect(replies[3].result).toEqual({ database: 'app', server: 'db.local' });
    expect(log).toEqual(['begin', 'lock customers', 'query select $1 ["x"]', 'commit']);
    expect(open).toHaveBeenCalledWith('postgres', URL_PG, 1000);
    client.close();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    // The connection goes with the socket: a transaction still open rolls back with it.
    expect(log.at(-1)).toBe('close');
  });

  it('never sends the password back in an error', async () => {
    const { call } = await serve(async () => fakeSession([]));
    await call({ op: 'open', kind: 'postgres', url: URL_PG, timeoutMs: 1000 });
    const reply = await call({ op: 'query', sql: { text: 'boom', values: [], names: [] } });
    expect(reply.error).toBe('password authentication failed: ***');
  });

  it('runs a queryDatabase statement on a connection of its own', async () => {
    const run = vi.fn<DatabaseRunner>(async () => ({
      columns: ['n'],
      rows: [{ n: 5n }],
      rowCount: 1,
    }));
    const { call } = await serve(async () => fakeSession([]), run);
    const reply = await call({
      op: 'run',
      kind: 'postgres',
      url: URL_PG,
      sql: 'select 5',
      timeoutMs: 1000,
    });
    expect(decodeDatabaseValue(reply.result)).toEqual({
      columns: ['n'],
      rows: [{ n: 5n }],
      rowCount: 1,
    });
    expect(run).toHaveBeenCalledWith('postgres', URL_PG, 'select 5', 1000);
  });

  it('says which driver to install when the agent has none', async () => {
    const { call } = await serve(async () => {
      throw Object.assign(new Error("Cannot find package 'mysql2'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });
    const reply = await call({
      op: 'open',
      kind: 'mysql',
      url: 'mysql://app:s3cret@db.local/app',
      timeoutMs: 1000,
    });
    expect(reply.error).toMatch(/no mysql driver.*npm install mysql2/);
  });
});
