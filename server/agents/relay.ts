import { randomUUID } from 'crypto';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  AGENT_PATHS,
  AGENT_PROTOCOL_VERSION,
  playwrightCompatible,
  type AgentHello,
  type AgentToServer,
  type ServerToAgent,
} from '@shared/agents';
import { verifyTicket, type BrowserTicket } from './agent-credentials';
import type { PublishedAgent, RelayDirectory, RelayInstance } from './relay-directory';

/**
 * The relay between runners and the browsers local agents lend them.
 *
 * Nothing dials an agent. Each agent keeps one standing connection to the relay. When a runner
 * wants a browser from a pool, it connects to the relay with a ticket. The relay picks an agent
 * of that organization and pool and asks it over the standing connection to open a browser. The
 * agent starts one (Playwright's launchServer) and opens a second outbound connection for it. From
 * then on the relay copies Playwright's protocol messages between the runner and that connection,
 * unread and unchanged. The runner drives the browser exactly as if it had launched it.
 *
 * Runs in the web server's process, on the address the agents dial. Runners reach it at
 * AGENT_RELAY_URL.
 *
 * With several web servers behind a load balancer, each is an instance of the relay, and an agent
 * is connected to whichever one it was given. The instances publish what they hold to a shared
 * directory (server/agents/relay-directory.ts). A request that reaches an instance without the
 * agent it needs — the runner's for a browser, or the agent's own second connection, which the
 * load balancer may send anywhere — is forwarded to the instance that has it, as one more
 * WebSocket copied both ways. Nothing new is trusted on the way: the instance at the end checks
 * the ticket or the agent's token itself.
 */

export interface RelayAgent {
  id: string;
  organizationId: number;
  pool: string;
  name: string;
}

export interface RelayCluster {
  directory: RelayDirectory;
  instanceId: string;
  /** Where the other instances reach this one directly (AGENT_RELAY_ADVERTISE_URL). */
  url: string;
  /** How often this instance publishes what it holds and reads what the others do. */
  syncMs?: number;
}

export interface AgentRelayOptions {
  authenticate: (token: string | null) => Promise<RelayAgent | null>;
  /** Called when an agent connects (with what it reported) and periodically while it stays. */
  onSeen?: (agentId: string, hello?: AgentHello) => Promise<void> | void;
  secret: () => string;
  /** How long an agent has to open a browser once asked. */
  openTimeoutMs?: number;
  /** How often an agent is pinged; one missed pong ends its connection. */
  heartbeatMs?: number;
  /** Absent: this is the only instance, as with one web server. */
  cluster?: RelayCluster;
  log?: (level: 'info' | 'warn', message: string, meta?: Record<string, unknown>) => void;
}

interface ConnectedAgent {
  agent: RelayAgent;
  /** Kept to ask again on every heartbeat, so a revocation made on another instance reaches this one. */
  token: string;
  ws: WebSocket;
  hello: AgentHello;
  sessions: Set<string>;
  draining: boolean;
  alive: boolean;
}

interface PendingSession {
  id: string;
  agentId: string;
  runner: WebSocket;
  buffered: Array<{ data: RawData; isBinary: boolean }>;
  timer: NodeJS.Timeout;
}

/** An agent that could serve a ticket: held here, or by another instance. */
type Candidate = PublishedAgent & { local?: ConnectedAgent; instance?: RelayInstance };

/** Marks a request one instance forwarded to another, which must then serve it or refuse it. */
export const RELAY_HOP_HEADER = 'x-wfm-relay-hop';

/** Session ids name the instance holding the session, so the agent's connection can be sent there. */
const SESSION_OWNER_SEPARATOR = '~';

/** WebSocket close reasons are limited to 123 bytes. */
const reasonOf = (text: string) => Buffer.from(text).subarray(0, 120).toString();

const STATUS_TEXT: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway', 503: 'Service Unavailable' };

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1] : null;
}

function refuse(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}\n`);
  socket.destroy();
}

/** A close code another WebSocket may be closed with; the ones only a library may set are not. */
function passableCode(code: number): number {
  return code === 1000 || (code >= 1001 && code <= 1014 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999) ? code : 1011;
}

/** Copies messages both ways until either side ends, and ends the other with it. */
function pipe(a: WebSocket, b: WebSocket, onEnd?: () => void) {
  a.on('message', (data, isBinary) => {
    if (b.readyState === WebSocket.OPEN) b.send(data, { binary: isBinary });
  });
  b.on('message', (data, isBinary) => {
    if (a.readyState === WebSocket.OPEN) a.send(data, { binary: isBinary });
  });
  const end = (other: WebSocket) => (code: number, reason: Buffer) => {
    if (other.readyState === WebSocket.OPEN || other.readyState === WebSocket.CONNECTING) other.close(passableCode(code), reason);
    onEnd?.();
  };
  a.on('close', end(b));
  b.on('close', end(a));
  a.on('error', () => b.terminate());
  b.on('error', () => a.terminate());
}

export class AgentRelay {
  private readonly connected = new Map<string, ConnectedAgent>();
  private readonly pending = new Map<string, PendingSession>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
  private readonly heartbeat: NodeJS.Timeout;
  private readonly syncTimer?: NodeJS.Timeout;
  private syncSoonTimer?: NodeJS.Timeout;
  /** The other instances, as of the last sync. */
  private others: RelayInstance[] = [];

  constructor(private readonly options: AgentRelayOptions) {
    this.heartbeat = setInterval(() => void this.beat(), options.heartbeatMs ?? 20_000);
    this.heartbeat.unref?.();
    if (options.cluster) {
      this.syncTimer = setInterval(() => void this.sync(), options.cluster.syncMs ?? 5_000);
      this.syncTimer.unref?.();
      void this.sync();
    }
  }

  /** Attached to the HTTP server's 'upgrade'. Leaves every other path to its own handler. */
  attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url ?? '', 'http://relay').pathname;
      if (pathname === AGENT_PATHS.connect) void this.acceptAgent(req, socket, head);
      else if (pathname.startsWith(AGENT_PATHS.session)) void this.acceptSession(req, socket, head, pathname.slice(AGENT_PATHS.session.length));
      else if (pathname === AGENT_PATHS.browser) this.acceptRunner(req, socket, head);
    });
  }

  /** Whether an agent is connected to this relay, or to another instance of it, right now. */
  isConnected(agentId: string): boolean {
    return this.connected.has(agentId) || this.others.some((i) => i.agents.some((a) => a.id === agentId));
  }

  /** How many browsers an agent is lending right now, wherever it is connected. */
  sessionsOf(agentId: string): number {
    const local = this.connected.get(agentId);
    if (local) return local.sessions.size;
    for (const instance of this.others) {
      const agent = instance.agents.find((a) => a.id === agentId);
      if (agent) return agent.activeSessions;
    }
    return 0;
  }

  /** Why a ticket would get no browser, or null when it would get one. Read before connecting, for a clear error. */
  availability(ticketValue: string): { available: true } | { available: false; reason: string } {
    const ticket = verifyTicket(ticketValue, this.options.secret());
    if ('error' in ticket) return { available: false, reason: `The relay refused the ticket (${ticket.error}).` };
    const chosen = this.choose(ticket, false);
    return 'candidate' in chosen ? { available: true } : { available: false, reason: chosen.reason };
  }

  /**
   * Ends an agent's standing connection here: it was revoked. Browsers it is lending finish as
   * they are. An agent connected to another instance is dropped there at its next heartbeat, when
   * its token no longer authenticates.
   */
  disconnect(agentId: string, reason: string) {
    const connected = this.connected.get(agentId);
    if (!connected) return;
    this.send(connected.ws, { type: 'refused', reason });
    connected.ws.close(4003, reasonOf(reason));
    this.connected.delete(agentId);
    this.syncSoon();
  }

  /** Publishes what this instance holds and reads what the others do. Runs on its own timer. */
  async sync(): Promise<void> {
    const cluster = this.options.cluster;
    if (!cluster) return;
    // Long enough that a busy moment — a browser starting, a pause for garbage collection — does not
    // make this instance vanish for the others; one that stops for good withdraws on close, and a
    // crashed one is forwarded to at most this long, with a refusal that names it.
    const ttlMs = Math.max((cluster.syncMs ?? 5_000) * 3, 15_000);
    try {
      await cluster.directory.publish({ id: cluster.instanceId, url: cluster.url, agents: this.published() }, ttlMs);
      this.others = (await cluster.directory.instances()).filter((i) => i.id !== cluster.instanceId);
    } catch (error) {
      this.log('warn', 'The agent relay could not reach its directory; other instances will not see its agents', { error: (error as Error).message });
    }
  }

  close() {
    clearInterval(this.heartbeat);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.syncSoonTimer) clearTimeout(this.syncSoonTimer);
    for (const { ws } of this.connected.values()) ws.terminate();
    for (const session of this.pending.values()) session.runner.terminate();
    this.connected.clear();
    this.pending.clear();
    this.wss.close();
    if (this.options.cluster) void this.options.cluster.directory.withdraw(this.options.cluster.instanceId).catch(() => {});
  }

  private log(level: 'info' | 'warn', message: string, meta?: Record<string, unknown>) {
    this.options.log?.(level, message, meta);
  }

  private send(ws: WebSocket, message: ServerToAgent) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  /** What the other instances need to choose this one's agents. */
  private published(): PublishedAgent[] {
    return [...this.connected.values()].map((c) => ({
      id: c.agent.id,
      organizationId: c.agent.organizationId,
      pool: c.agent.pool,
      playwrightVersion: c.hello.playwrightVersion,
      browsers: c.hello.browsers,
      maxSessions: c.hello.maxSessions,
      activeSessions: c.sessions.size,
      draining: c.draining,
    }));
  }

  /** An agent arrived or left: the others should know before the next regular sync. */
  private syncSoon() {
    if (!this.options.cluster || this.syncSoonTimer) return;
    this.syncSoonTimer = setTimeout(() => {
      this.syncSoonTimer = undefined;
      void this.sync();
    }, 100);
  }

  private async beat() {
    for (const [id, connected] of this.connected) {
      if (!connected.alive) {
        this.log('warn', 'Local agent stopped answering; dropping its connection', { agentId: id });
        connected.ws.terminate();
        continue;
      }
      connected.alive = false;
      connected.ws.ping();
      void this.options.onSeen?.(id);
      // Revoked since it connected, perhaps through another instance.
      const still = await this.options.authenticate(connected.token).catch(() => connected.agent);
      if (!still && this.connected.get(id) === connected) this.disconnect(id, 'This agent was revoked.');
    }
  }

  private async acceptAgent(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const token = bearer(req);
    const agent = await this.options.authenticate(token).catch(() => null);
    if (!agent || !token) return refuse(socket, 401, 'Unknown or revoked agent token.');

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const helloTimer = setTimeout(() => ws.close(4000, 'No hello.'), 10_000);
      ws.once('message', (data) => {
        clearTimeout(helloTimer);
        let hello: AgentHello;
        try {
          hello = JSON.parse(data.toString());
        } catch {
          return ws.close(4000, 'Expected a hello.');
        }
        if (hello?.type !== 'hello' || hello.protocol !== AGENT_PROTOCOL_VERSION) {
          const reason = `This server speaks agent protocol ${AGENT_PROTOCOL_VERSION}; download the agent again from /cli/wfm-agent.mjs.`;
          this.send(ws, { type: 'refused', reason });
          return ws.close(4002, reasonOf(reason));
        }

        // One connection per agent: a reconnect replaces a connection the network already lost.
        const previous = this.connected.get(agent.id);
        if (previous) previous.ws.terminate();

        const connected: ConnectedAgent = {
          agent,
          token,
          ws,
          hello: { ...hello, maxSessions: Math.max(1, Math.min(Number(hello.maxSessions) || 1, 16)) },
          sessions: new Set(),
          draining: false,
          alive: true,
        };
        this.connected.set(agent.id, connected);
        this.send(ws, { type: 'welcome', agentId: agent.id, name: agent.name, pool: agent.pool });
        void this.options.onSeen?.(agent.id, hello);
        this.syncSoon();
        this.log('info', 'Local agent connected', { agentId: agent.id, pool: agent.pool, hostname: hello.hostname, playwright: hello.playwrightVersion });

        ws.on('pong', () => {
          connected.alive = true;
        });
        ws.on('message', (raw) => {
          let message: AgentToServer;
          try {
            message = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (message.type === 'draining') {
            connected.draining = true;
            this.syncSoon();
          }
          if (message.type === 'open_failed') {
            const session = this.pending.get(message.sessionId);
            if (session && session.agentId === agent.id) this.failSession(session, `The agent could not start the browser: ${message.error}`);
          }
        });
        ws.on('close', () => {
          if (this.connected.get(agent.id)?.ws === ws) this.connected.delete(agent.id);
          for (const session of this.pending.values()) {
            if (session.agentId === agent.id) this.failSession(session, 'The agent disconnected before opening the browser.');
          }
          this.syncSoon();
          this.log('info', 'Local agent disconnected', { agentId: agent.id });
        });
      });
    });
  }

  /**
   * The least busy agent that can serve the ticket, here or on another instance, or why there is
   * none. A forwarded request looks only here: the instance that forwarded it already chose this one.
   */
  private choose(ticket: BrowserTicket, localOnly: boolean): { candidate: Candidate } | { reason: string } {
    const local: Candidate[] = [...this.connected.values()].map((c) => ({
      id: c.agent.id,
      organizationId: c.agent.organizationId,
      pool: c.agent.pool,
      playwrightVersion: c.hello.playwrightVersion,
      browsers: c.hello.browsers,
      maxSessions: c.hello.maxSessions,
      activeSessions: c.sessions.size,
      draining: c.draining,
      local: c,
    }));
    const remote: Candidate[] = localOnly
      ? []
      : this.others.flatMap((instance) =>
          instance.agents.filter((a) => !this.connected.has(a.id)).map((a) => ({ ...a, instance })),
        );

    const inPool = [...local, ...remote].filter((c) => c.organizationId === ticket.organizationId && c.pool === ticket.pool);
    if (inPool.length === 0) return { reason: `No agent of pool "${ticket.pool}" is connected. Start one, or run the plan on the server's runners.` };
    const compatible = inPool.filter((c) => playwrightCompatible(c.playwrightVersion, ticket.playwrightVersion));
    if (compatible.length === 0) {
      return {
        reason:
          `The agents of pool "${ticket.pool}" run Playwright ${[...new Set(inPool.map((c) => c.playwrightVersion))].join(', ')}, ` +
          `and this server ${ticket.playwrightVersion}: they must match. Update the agents.`,
      };
    }
    const withBrowser = compatible.filter((c) => c.browsers.includes(ticket.engine));
    if (withBrowser.length === 0) return { reason: `No agent of pool "${ticket.pool}" has ${ticket.engine} installed.` };
    const free = withBrowser.filter((c) => !c.draining && c.activeSessions < c.maxSessions);
    if (free.length === 0) return { reason: `Every agent of pool "${ticket.pool}" is busy or draining.` };
    // Least busy first; between equals, one held here saves a hop.
    free.sort((a, b) => a.activeSessions - b.activeSessions || Number(!a.local) - Number(!b.local));
    return { candidate: free[0] };
  }

  private acceptRunner(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const value = new URL(req.url ?? '', 'http://relay').searchParams.get('ticket') ?? '';
    let ticket: BrowserTicket | { error: string };
    try {
      ticket = verifyTicket(value, this.options.secret());
    } catch {
      return refuse(socket, 503, 'The relay has no secret configured.');
    }
    if ('error' in ticket) return refuse(socket, 401, `Ticket refused: ${ticket.error}.`);
    const chosen = this.choose(ticket, Boolean(req.headers[RELAY_HOP_HEADER]));
    if (!('candidate' in chosen)) return refuse(socket, 503, chosen.reason);
    if (chosen.candidate.instance) return this.forward(req, socket, head, chosen.candidate.instance);
    const agent = chosen.candidate.local!;
    const verified = ticket;

    this.wss.handleUpgrade(req, socket, head, (runner) => {
      const cluster = this.options.cluster;
      const id = cluster ? `${cluster.instanceId}${SESSION_OWNER_SEPARATOR}${randomUUID()}` : randomUUID();
      const session: PendingSession = {
        id,
        agentId: agent.agent.id,
        runner,
        buffered: [],
        timer: setTimeout(() => this.failSession(session, 'The agent did not open a browser in time.'), this.options.openTimeoutMs ?? 30_000),
      };
      this.pending.set(id, session);
      agent.sessions.add(id);
      // The runner starts talking the moment it is connected; held until the browser is there.
      runner.on('message', (data, isBinary) => {
        if (this.pending.has(id)) session.buffered.push({ data, isBinary });
      });
      runner.on('close', () => {
        if (this.pending.delete(id)) clearTimeout(session.timer);
        agent.sessions.delete(id);
      });
      this.send(agent.ws, { type: 'open', sessionId: id, engine: verified.engine, channel: verified.channel, headless: verified.headless });
    });
  }

  private failSession(session: PendingSession, reason: string) {
    if (!this.pending.delete(session.id)) return;
    clearTimeout(session.timer);
    this.connected.get(session.agentId)?.sessions.delete(session.id);
    this.log('warn', 'A lent browser could not be opened', { agentId: session.agentId, reason });
    session.runner.close(1011, reasonOf(reason));
  }

  private async acceptSession(req: IncomingMessage, socket: Duplex, head: Buffer, sessionId: string) {
    const agent = await this.options.authenticate(bearer(req)).catch(() => null);
    if (!agent) return refuse(socket, 401, 'Unknown or revoked agent token.');
    const session = this.pending.get(sessionId);

    if (!session && !req.headers[RELAY_HOP_HEADER]) {
      // The load balancer sent the agent's connection to an instance that is not holding the
      // runner; the session id says which one is.
      const owner = sessionId.includes(SESSION_OWNER_SEPARATOR) ? sessionId.split(SESSION_OWNER_SEPARATOR)[0] : null;
      let instance = owner ? this.others.find((i) => i.id === owner) : undefined;
      if (!instance && owner && owner !== this.options.cluster?.instanceId) {
        // Not in what this instance last read; the directory may know it by now.
        await this.sync();
        instance = this.others.find((i) => i.id === owner);
      }
      if (instance) return this.forward(req, socket, head, instance);
    }
    // Only the agent that was asked may answer: another agent, even of the same organization, is refused.
    if (!session || session.agentId !== agent.id) return refuse(socket, 403, 'No such session for this agent.');

    this.wss.handleUpgrade(req, socket, head, (lent) => {
      this.pending.delete(sessionId);
      clearTimeout(session.timer);
      const { runner } = session;
      for (const { data, isBinary } of session.buffered) lent.send(data, { binary: isBinary });
      session.buffered = [];
      runner.removeAllListeners('message');
      pipe(runner, lent, () => this.connected.get(agent.id)?.sessions.delete(sessionId));
    });
  }

  /**
   * Hands a request to the instance that can serve it, and copies the conversation both ways.
   *
   * The caller is answered only once that instance has: its refusal, with its status and its
   * reason, becomes this one's, so a runner hears "every agent is busy" and not "bad gateway".
   */
  private forward(req: IncomingMessage, socket: Duplex, head: Buffer, instance: RelayInstance) {
    const cluster = this.options.cluster!;
    const headers: Record<string, string> = { [RELAY_HOP_HEADER]: cluster.instanceId };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const target = `${instance.url.replace(/\/+$/, '').replace(/^http/i, 'ws')}${req.url ?? ''}`;
    const upstream = new WebSocket(target, { headers, maxPayload: 256 * 1024 * 1024 });
    let answered = false;

    upstream.on('unexpected-response', (_request, response) => {
      answered = true;
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => refuse(socket, response.statusCode ?? 502, body.trim() || 'The relay instance holding the agent refused.'));
    });
    upstream.on('error', (error) => {
      if (answered) return;
      answered = true;
      this.log('warn', 'Could not reach another relay instance', { instance: instance.id, url: instance.url, error: error.message });
      refuse(socket, 502, `The relay instance holding the agent (${instance.id}) could not be reached. Check AGENT_RELAY_ADVERTISE_URL.`);
    });
    upstream.on('open', () => {
      answered = true;
      this.wss.handleUpgrade(req, socket, head, (downstream) => pipe(downstream, upstream));
    });
  }
}

let relay: AgentRelay | null = null;

/** The relay of this process, when it runs one (the web server does; runners do not). */
export function agentRelay(): AgentRelay | null {
  return relay;
}

export function setAgentRelay(value: AgentRelay | null) {
  relay = value;
}
