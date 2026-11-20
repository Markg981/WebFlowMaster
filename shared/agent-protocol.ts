/** The protocols an agent sends a request in for an API test. */
export type AgentNetworkProtocol = 'grpc' | 'websocket';
/**
 * What a relay session can be lent for besides a browser. `database` is a session on the
 * application's database for data fixtures and the queryDatabase step (data fixtures, release 3):
 * an agent that does not advertise it is older than the feature and must be updated.
 */
export type AgentApiProtocol = AgentNetworkProtocol | 'database';
export const AGENT_API_PROTOCOLS: readonly AgentApiProtocol[] = ['grpc', 'websocket', 'database'];
export const AGENT_API_FEATURES = ['native-protocol-v2'] as const;
export type AgentApiFeature = (typeof AGENT_API_FEATURES)[number];
// The bounded response appears as messages, last and text; JSON escaping expands it again.
export const AGENT_API_MAX_PAYLOAD = 64 * 1024 * 1024;

export interface ProtocolResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  text: string;
}

/** One request per authenticated relay session. URLs and proto text travel as strings. */
export interface AgentProtocolRequest {
  protocol: AgentNetworkProtocol;
  url: string;
  proto?: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  config?: import('./api-protocol-config').ResolvedProtocolConfig;
}

export type AgentProtocolReply = { response: ProtocolResponse } | { error: string };

/** The dialects the agent's database session speaks, as server/runtime/database-step.ts names them. */
export type AgentDatabaseKind = 'postgres' | 'mysql' | 'sqlserver';

/**
 * The bounds of a database session lent by an agent. The agent refuses a call past them, and the
 * relay lends at most `maxSessions` at once per agent, apart from its browsers: a fixture's
 * session is short and light, and must not wait behind the browser of the test it prepares.
 */
export const AGENT_DATABASE_LIMITS = {
  maxSessions: 8,
  /** One statement's text, after the template has bound its values. */
  maxSqlBytes: 1024 * 1024,
  /** SQL Server's own limit on the parameters of one statement. */
  maxValues: 2100,
  maxTimeoutMs: 5 * 60_000,
  /** A session nobody calls for this long is closed; its open transaction rolls back. */
  idleMs: 5 * 60_000,
  /** And none lasts longer than this, whatever it is doing. */
  maxSessionMs: 30 * 60_000,
} as const;

/** A statement with its values bound as parameters (shared/sql-template.ts BoundSql). */
export interface AgentBoundSql {
  text: string;
  values: unknown[];
  names: string[];
}

/**
 * One call on a database session, answered by one AgentDatabaseReply with the same id. The
 * first call opens the connection: the address, password included, travels in it and lives only
 * as long as the session; the agent keeps no copy.
 */
export type AgentDatabaseCall =
  | { id: number; op: 'open'; kind: AgentDatabaseKind; url: string; timeoutMs: number }
  /** One statement on a connection of its own, as the queryDatabase step runs it; no open first. */
  | { id: number; op: 'run'; kind: AgentDatabaseKind; url: string; sql: string; timeoutMs: number }
  | { id: number; op: 'query'; sql: AgentBoundSql }
  | { id: number; op: 'begin' | 'commit' | 'rollback' | 'identity' | 'close' }
  | { id: number; op: 'lock'; key: string; timeoutMs: number };

export type AgentDatabaseReply = { id: number; result: unknown } | { id: number; error: string };
