import WebSocket from 'ws';
import {
  AGENT_DATABASE_LIMITS,
  type AgentDatabaseCall,
  type AgentDatabaseKind,
  type AgentDatabaseReply,
} from '../shared/agent-protocol';
import { encodeDatabaseValue } from '../server/runtime/agents/database-wire';
import {
  openSqlSession,
  type SqlSession,
  type SqlSessionFactory,
} from '../server/runtime/data-setup/sql-session';
import {
  databaseKind,
  redactMessage,
  runDatabaseQuery,
  type DatabaseRunner,
} from '../server/runtime/database-step';

const DRIVERS = { postgres: 'pg', mysql: 'mysql2', sqlserver: 'mssql' } as const;

/** The driver a dialect needs is loaded on first use; an agent installed without it says so. */
async function withDriver<T>(kind: AgentDatabaseKind, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
      String((error as Error).message).includes(DRIVERS[kind])
    )
      throw new Error(
        `This agent has no ${kind} driver: install it beside wfm-agent.mjs (npm install ${DRIVERS[kind]}), or rebuild the agent's Docker image.`,
      );
    throw error;
  }
}

/** Why a call cannot be run, before it reaches the driver; null when it can. */
export function invalidDatabaseCall(call: AgentDatabaseCall, opened: boolean): string | null {
  if (!call || typeof call !== 'object' || !Number.isInteger(call.id)) return 'Invalid call.';
  const timeout = (ms: unknown) =>
    typeof ms === 'number' && Number.isFinite(ms) && ms > 0 && ms <= AGENT_DATABASE_LIMITS.maxTimeoutMs;
  switch (call.op) {
    case 'open':
      if (opened) return 'The session is open already.';
      if (typeof call.url !== 'string' || databaseKind(call.url) !== call.kind)
        return 'The database address does not match its dialect.';
      return timeout(call.timeoutMs) ? null : 'Invalid timeout.';
    case 'run':
      if (opened) return 'The session is open already.';
      if (typeof call.url !== 'string' || databaseKind(call.url) !== call.kind)
        return 'The database address does not match its dialect.';
      if (typeof call.sql !== 'string' || Buffer.byteLength(call.sql) > AGENT_DATABASE_LIMITS.maxSqlBytes)
        return 'Invalid statement.';
      return timeout(call.timeoutMs) ? null : 'Invalid timeout.';
    case 'query': {
      const sql = call.sql;
      if (
        !sql ||
        typeof sql.text !== 'string' ||
        !Array.isArray(sql.values) ||
        !Array.isArray(sql.names) ||
        !sql.names.every((name) => typeof name === 'string')
      )
        return 'Invalid statement.';
      if (Buffer.byteLength(sql.text) > AGENT_DATABASE_LIMITS.maxSqlBytes)
        return `The statement is longer than ${AGENT_DATABASE_LIMITS.maxSqlBytes} bytes.`;
      if (sql.values.length > AGENT_DATABASE_LIMITS.maxValues)
        return `The statement has more than ${AGENT_DATABASE_LIMITS.maxValues} values.`;
      // Values are what a fixture's parameters can be: text, numbers, true or false, or nothing.
      if (!sql.values.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)))
        return 'A value of the statement is not text, a number or a boolean.';
      break;
    }
    case 'lock':
      if (typeof call.key !== 'string' || call.key.length === 0 || call.key.length > 1000)
        return 'Invalid lock key.';
      if (!timeout(call.timeoutMs)) return 'Invalid timeout.';
      break;
    case 'begin':
    case 'commit':
    case 'rollback':
    case 'identity':
    case 'close':
      break;
    default:
      return 'Unknown call.';
  }
  return opened ? null : 'The session is not open.';
}

/**
 * A session on the application's database, lent to the server over the relay: the server's data
 * fixtures and queryDatabase steps reach a database only this agent's network can (a local DMO,
 * a database behind the company firewall). The calls are run one at a time, in order.
 *
 * No egress policy applies here: the agent is inside the network it was installed to reach, and
 * the server's policy describes the server's network, not this one.
 */
export function serveDatabaseSession(
  socket: WebSocket,
  done: () => void,
  open: SqlSessionFactory = openSqlSession,
  runQuery: DatabaseRunner = runDatabaseQuery,
): void {
  let session: SqlSession | null = null;
  let url = '';
  let closed = false;
  let queue: Promise<void> = Promise.resolve();
  const lifetime = setTimeout(() => socket.close(1000, 'The database session lasted too long.'), AGENT_DATABASE_LIMITS.maxSessionMs);
  let idle = setTimeout(() => socket.close(1000, 'The database session was idle.'), AGENT_DATABASE_LIMITS.idleMs);

  const finish = () => {
    if (closed) return;
    closed = true;
    clearTimeout(lifetime);
    clearTimeout(idle);
    const current = session;
    session = null;
    // A transaction still open rolls back with the connection.
    queue = queue.then(() => current?.close()).catch(() => {});
    void queue.finally(done);
  };
  socket.once('close', finish);
  socket.on('error', () => socket.terminate());

  const reply = (message: AgentDatabaseReply) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const run = async (call: AgentDatabaseCall): Promise<unknown> => {
    const invalid = invalidDatabaseCall(call, session !== null);
    if (invalid) throw new Error(invalid);
    if (call.op === 'run') {
      url = call.url;
      return encodeDatabaseValue(
        await withDriver(call.kind, () => runQuery(call.kind, call.url, call.sql, call.timeoutMs)),
      );
    }
    if (call.op === 'open') {
      url = call.url;
      session = await withDriver(call.kind, () => open(call.kind, call.url, call.timeoutMs));
      return null;
    }
    const current = session!;
    switch (call.op) {
      case 'query':
        return encodeDatabaseValue(await current.query(call.sql));
      case 'begin':
        return current.begin();
      case 'commit':
        return current.commit();
      case 'rollback':
        return current.rollback();
      case 'lock':
        return current.lock(call.key, call.timeoutMs);
      case 'identity':
        return current.identity();
      case 'close':
        session = null;
        await current.close();
        return null;
    }
  };

  socket.on('message', (raw) => {
    clearTimeout(idle);
    idle = setTimeout(() => socket.close(1000, 'The database session was idle.'), AGENT_DATABASE_LIMITS.idleMs);
    let call: AgentDatabaseCall;
    try {
      call = JSON.parse(raw.toString()) as AgentDatabaseCall;
    } catch {
      return reply({ id: -1, error: 'Invalid call.' });
    }
    queue = queue.then(async () => {
      if (closed) return;
      try {
        reply({ id: call.id, result: (await run(call)) ?? null });
      } catch (error) {
        // The address may be in the driver's message; it never leaves the agent.
        const message = (error as Error)?.message ?? String(error);
        reply({ id: call?.id ?? -1, error: url ? redactMessage(message, url) : message });
      }
    });
  });
}
