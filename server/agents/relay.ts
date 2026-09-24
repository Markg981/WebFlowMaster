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
 * AGENT_RELAY_URL. With more than one web server, that address must lead to the one the agents are
 * connected to.
 */

export interface RelayAgent {
  id: string;
  organizationId: number;
  pool: string;
  name: string;
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
  log?: (level: 'info' | 'warn', message: string, meta?: Record<string, unknown>) => void;
}

interface ConnectedAgent {
  agent: RelayAgent;
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

/** WebSocket close reasons are limited to 123 bytes. */
const reasonOf = (text: string) => Buffer.from(text).subarray(0, 120).toString();

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1] : null;
}

function refuse(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Service Unavailable'}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}\n`);
  socket.destroy();
}

export class AgentRelay {
  private readonly connected = new Map<string, ConnectedAgent>();
  private readonly pending = new Map<string, PendingSession>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly options: AgentRelayOptions) {
    this.heartbeat = setInterval(() => this.beat(), options.heartbeatMs ?? 20_000);
    this.heartbeat.unref?.();
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

  /** Whether an agent is connected to this relay right now. */
  isConnected(agentId: string): boolean {
    return this.connected.has(agentId);
  }

  /** How many browsers an agent is lending right now. */
  sessionsOf(agentId: string): number {
    return this.connected.get(agentId)?.sessions.size ?? 0;
  }

  /** Why a ticket would get no browser, or null when it would get one. Read before connecting, for a clear error. */
  availability(ticketValue: string): { available: true } | { available: false; reason: string } {
    const ticket = verifyTicket(ticketValue, this.options.secret());
    if ('error' in ticket) return { available: false, reason: `The relay refused the ticket (${ticket.error}).` };
    const chosen = this.choose(ticket);
    return 'agent' in chosen ? { available: true } : { available: false, reason: chosen.reason };
  }

  /** Ends an agent's standing connection: it was revoked. Browsers it is lending finish as they are. */
  disconnect(agentId: string, reason: string) {
    const connected = this.connected.get(agentId);
    if (!connected) return;
    this.send(connected.ws, { type: 'refused', reason });
    connected.ws.close(4003, reasonOf(reason));
    this.connected.delete(agentId);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const { ws } of this.connected.values()) ws.terminate();
    for (const session of this.pending.values()) session.runner.terminate();
    this.connected.clear();
    this.pending.clear();
    this.wss.close();
  }

  private log(level: 'info' | 'warn', message: string, meta?: Record<string, unknown>) {
    this.options.log?.(level, message, meta);
  }

  private send(ws: WebSocket, message: ServerToAgent) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private beat() {
    for (const [id, connected] of this.connected) {
      if (!connected.alive) {
        this.log('warn', 'Local agent stopped answering; dropping its connection', { agentId: id });
        connected.ws.terminate();
        continue;
      }
      connected.alive = false;
      connected.ws.ping();
      void this.options.onSeen?.(id);
    }
  }

  private async acceptAgent(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const agent = await this.options.authenticate(bearer(req)).catch(() => null);
    if (!agent) return refuse(socket, 401, 'Unknown or revoked agent token.');

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
          ws,
          hello: { ...hello, maxSessions: Math.max(1, Math.min(Number(hello.maxSessions) || 1, 16)) },
          sessions: new Set(),
          draining: false,
          alive: true,
        };
        this.connected.set(agent.id, connected);
        this.send(ws, { type: 'welcome', agentId: agent.id, name: agent.name, pool: agent.pool });
        void this.options.onSeen?.(agent.id, hello);
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
          if (message.type === 'draining') connected.draining = true;
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
          this.log('info', 'Local agent disconnected', { agentId: agent.id });
        });
      });
    });
  }

  /** The least busy agent that can serve the ticket, or why there is none. */
  private choose(ticket: BrowserTicket): { agent: ConnectedAgent } | { reason: string } {
    const inPool = [...this.connected.values()].filter(
      (c) => c.agent.organizationId === ticket.organizationId && c.agent.pool === ticket.pool,
    );
    if (inPool.length === 0) return { reason: `No agent of pool "${ticket.pool}" is connected. Start one, or run the plan on the server's runners.` };
    const compatible = inPool.filter((c) => playwrightCompatible(c.hello.playwrightVersion, ticket.playwrightVersion));
    if (compatible.length === 0) {
      return {
        reason:
          `The agents of pool "${ticket.pool}" run Playwright ${inPool.map((c) => c.hello.playwrightVersion).join(', ')}, ` +
          `and this server ${ticket.playwrightVersion}: they must match. Update the agents.`,
      };
    }
    const withBrowser = compatible.filter((c) => c.hello.browsers.includes(ticket.engine));
    if (withBrowser.length === 0) return { reason: `No agent of pool "${ticket.pool}" has ${ticket.engine} installed.` };
    const free = withBrowser.filter((c) => !c.draining && c.sessions.size < c.hello.maxSessions);
    if (free.length === 0) return { reason: `Every agent of pool "${ticket.pool}" is busy or draining.` };
    free.sort((a, b) => a.sessions.size - b.sessions.size);
    return { agent: free[0] };
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
    const chosen = this.choose(ticket);
    if (!('agent' in chosen)) return refuse(socket, 503, chosen.reason);
    const { agent } = chosen;
    const verified = ticket;

    this.wss.handleUpgrade(req, socket, head, (runner) => {
      const id = randomUUID();
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
    // Only the agent that was asked may answer: another agent, even of the same organization, is refused.
    if (!session || session.agentId !== agent.id) return refuse(socket, 403, 'No such session for this agent.');

    this.wss.handleUpgrade(req, socket, head, (lent) => {
      this.pending.delete(sessionId);
      clearTimeout(session.timer);
      const { runner } = session;
      for (const { data, isBinary } of session.buffered) lent.send(data, { binary: isBinary });
      session.buffered = [];
      runner.removeAllListeners('message');
      runner.on('message', (data, isBinary) => {
        if (lent.readyState === WebSocket.OPEN) lent.send(data, { binary: isBinary });
      });
      lent.on('message', (data, isBinary) => {
        if (runner.readyState === WebSocket.OPEN) runner.send(data, { binary: isBinary });
      });
      const end = (other: WebSocket) => () => {
        if (other.readyState === WebSocket.OPEN || other.readyState === WebSocket.CONNECTING) other.close();
        this.connected.get(agent.id)?.sessions.delete(sessionId);
      };
      runner.on('close', end(lent));
      lent.on('close', end(runner));
      runner.on('error', () => lent.terminate());
      lent.on('error', () => runner.terminate());
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
