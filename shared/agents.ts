/**
 * Local agents: browsers inside a customer's network, lent to the runner over an outbound link.
 *
 * The application under test is often not on the internet: a staging environment behind a VPN,
 * an intranet, an ERP reachable only from the office. A runner in the cloud cannot open it. An
 * agent is a small process started inside that network. It opens connections outward to the
 * server (no inbound port, no VPN) and, when a run asks for it, starts a browser there and lends
 * it to the runner. The runner drives it exactly as it drives its own, so healing, visual checks,
 * accessibility, video, trace and HAR all work unchanged. The difference is where the browser is,
 * and so what it can reach.
 *
 * What does not move is what the runner does itself. API tests and API preconditions are sent
 * from the runner, so an internal API they call must still be reachable from it.
 */

/** Paths on the server. The agent dials all of them; nothing dials the agent. */
export const AGENT_PATHS = {
  /** The agent's standing connection: authenticated by its token, it receives requests to open a browser. */
  connect: '/api/agent/v1/connect',
  /** One per lent browser: the agent's side of the pipe, opened when asked. */
  session: '/api/agent/v1/session/',
  /** The runner's side of the pipe: what `browserType.connect()` is pointed at, with a ticket. */
  browser: '/api/agent/v1/browser',
} as const;

/** Bumped when the messages below change incompatibly; an agent speaking another is refused by name. */
export const AGENT_PROTOCOL_VERSION = 1;

/** Pool names: short, lowercase, and safe in a URL and a log line. */
export const AGENT_POOL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const AGENT_TOKEN_PREFIX = 'wfa_';

export type AgentEngine = 'chromium' | 'firefox' | 'webkit';

/** Agent → server, first message on the standing connection. */
export interface AgentHello {
  type: 'hello';
  protocol: number;
  agentVersion: string;
  /** The playwright package the agent runs. The runner's must match major.minor to drive it. */
  playwrightVersion: string;
  hostname: string;
  /** Browsers this machine has installed. */
  browsers: AgentEngine[];
  /** How many browsers it lends at once. */
  maxSessions: number;
}

/** Server → agent. */
export type ServerToAgent =
  | { type: 'welcome'; agentId: string; name: string; pool: string }
  | { type: 'refused'; reason: string }
  | { type: 'open'; sessionId: string; engine: AgentEngine; channel?: string; headless: boolean };

/** Agent → server, after hello. */
export type AgentToServer =
  | AgentHello
  | { type: 'open_failed'; sessionId: string; error: string }
  | { type: 'draining' };

/** Whether two Playwright versions can drive each other: the wire protocol changes between minors. */
export function playwrightCompatible(a: string, b: string): boolean {
  const majorMinor = (version: string) => version.split('.').slice(0, 2).join('.');
  return majorMinor(a) === majorMinor(b);
}
