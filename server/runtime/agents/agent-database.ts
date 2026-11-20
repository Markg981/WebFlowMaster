import { SpanKind } from '@opentelemetry/api';
import WebSocket from 'ws';
import { withSpan } from '../../../shared/telemetry';
import { AGENT_PATHS } from '@shared/agents';
import {
  AGENT_API_MAX_PAYLOAD,
  type AgentDatabaseCall,
  type AgentDatabaseReply,
} from '@shared/agent-protocol';
import type { DatabaseKind, DatabaseResult, DatabaseRunner } from '../database-step';
import type { DataRunner } from '../data-setup/data-runner';
import type { DatabaseIdentity, SqlSession, SqlSessionFactory } from '../data-setup/sql-session';
import { relayBaseUrl, RUNNER_PLAYWRIGHT_VERSION, type AgentTarget } from './agent-browser';
import { relaySecret, signTicket } from './agent-credentials';
import { awaitAgentSlot } from './agent-protocol';
import { decodeDatabaseValue } from './database-wire';

/** What a call may take beyond its own timeout: the relay hop and the agent's queue. */
const CALL_ALLOWANCE_MS = 30_000;

type CallBody = AgentDatabaseCall extends infer C
  ? C extends { id: number }
    ? Omit<C, 'id'>
    : never
  : never;

/** One database session lent by an agent of the pool, called one statement at a time. */
class AgentDatabaseSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private failure: Error | null = null;

  private constructor(
    private readonly socket: WebSocket,
    private readonly pool: string,
  ) {
    socket.on('message', (raw) => {
      let reply: AgentDatabaseReply;
      try {
        reply = JSON.parse(raw.toString()) as AgentDatabaseReply;
      } catch {
        return this.fail(new Error('The agent sent an invalid database reply.'));
      }
      const waiting = this.pending.get(reply.id);
      if (!waiting) {
        // A call the agent could not even read: nothing else on the session can be trusted.
        if ('error' in reply) this.fail(new Error(reply.error));
        return;
      }
      this.pending.delete(reply.id);
      clearTimeout(waiting.timer);
      if ('error' in reply) waiting.reject(new Error(reply.error));
      else waiting.resolve(reply.result);
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', (_code, reason) =>
      this.fail(
        new Error(reason.toString() || `The agent of pool "${pool}" closed the database session.`),
      ),
    );
  }

  static async connect(
    agent: AgentTarget,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal | undefined,
    waitForSlotMs: number,
  ): Promise<AgentDatabaseSession> {
    const ticket = signTicket(
      {
        ...agent,
        engine: 'chromium',
        headless: true,
        playwrightVersion: RUNNER_PLAYWRIGHT_VERSION,
        apiProtocol: 'database',
      },
      relaySecret(env),
    );
    const base = relayBaseUrl(env);
    await awaitAgentSlot(
      base,
      ticket,
      signal,
      waitForSlotMs,
      `No agent of pool "${agent.pool}" can run database scripts.`,
    );
    const socket = new WebSocket(
      `${base.replace(/^http/i, 'ws')}${AGENT_PATHS.browser}?ticket=${encodeURIComponent(ticket)}`,
      { handshakeTimeout: 10_000, maxPayload: AGENT_API_MAX_PAYLOAD },
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
      socket.once('unexpected-response', (_req, response) => {
        response.resume();
        reject(
          new Error(`The agent relay refused the database session: HTTP ${response.statusCode}.`),
        );
      });
    });
    const session = new AgentDatabaseSession(socket, agent.pool);
    if (signal) {
      const onAbort = () => session.terminate('The database session was stopped with the run.');
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      socket.once('close', () => signal.removeEventListener('abort', onAbort));
    }
    return session;
  }

  call(body: CallBody, timeoutMs: number): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The database on agent pool "${this.pool}" did not answer in time.`));
        // The agent is still running it: the session is closed so the statement goes with it.
        this.terminate('A call on the database session timed out.');
      }, timeoutMs + CALL_ALLOWANCE_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ ...body, id }));
    });
  }

  terminate(reason: string): void {
    this.fail(new Error(reason));
    this.socket.terminate();
  }

  close(): void {
    this.failure ??= new Error('The database session is closed.');
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const [id, waiting] of this.pending) {
      this.pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.reject(this.failure);
    }
  }
}

const result = (value: unknown) => decodeDatabaseValue(value) as DatabaseResult;

/**
 * The data runner of a plan on an agent pool: every connection is opened by an agent of the pool,
 * from its network. An agent older than this answers that it cannot, and the fixture fails with
 * the relay's "update the agents".
 */
export function agentDataRunner(
  agent: AgentTarget,
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; waitForSlotMs?: number } = {},
): DataRunner {
  const env = options.env ?? process.env;
  const waitForSlotMs = options.waitForSlotMs ?? 6000;
  const connect = () =>
    withSpan('agent.databaseSession', SpanKind.CLIENT, undefined, () =>
      AgentDatabaseSession.connect(agent, env, options.signal, waitForSlotMs),
    );

  const openSession: SqlSessionFactory = async (kind, url, timeoutMs) => {
    const remote = await connect();
    try {
      await remote.call({ op: 'open', kind, url, timeoutMs }, timeoutMs);
    } catch (error) {
      remote.close();
      throw error;
    }
    const session: SqlSession = {
      kind,
      query: async (bound) =>
        result(
          await remote.call(
            { op: 'query', sql: { text: bound.text, values: bound.values, names: bound.names } },
            timeoutMs,
          ),
        ),
      begin: async () => void (await remote.call({ op: 'begin' }, timeoutMs)),
      commit: async () => void (await remote.call({ op: 'commit' }, timeoutMs)),
      rollback: async () => void (await remote.call({ op: 'rollback' }, timeoutMs).catch(() => {})),
      lock: async (key, lockTimeoutMs) =>
        void (await remote.call(
          { op: 'lock', key, timeoutMs: lockTimeoutMs },
          Math.max(timeoutMs, lockTimeoutMs),
        )),
      identity: async () => (await remote.call({ op: 'identity' }, timeoutMs)) as DatabaseIdentity,
      close: async () => {
        await remote.call({ op: 'close' }, timeoutMs).catch(() => {});
        remote.close();
      },
    };
    return session;
  };

  const query: DatabaseRunner = async (kind: DatabaseKind, url, sql, timeoutMs) => {
    const remote = await connect();
    try {
      return result(await remote.call({ op: 'run', kind, url, sql, timeoutMs }, timeoutMs));
    } finally {
      remote.close();
    }
  };

  return {
    where: `agent pool "${agent.pool}"`,
    // The agent's network is where the connection goes; the server's egress policy is not asked.
    vet: async () => ({ host: '' }),
    openSession,
    query,
  };
}
