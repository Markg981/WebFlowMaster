export type AgentApiProtocol = 'grpc' | 'websocket';
export const AGENT_API_FEATURES = ['native-protocol-v2'] as const;
export type AgentApiFeature = typeof AGENT_API_FEATURES[number];
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
  protocol: AgentApiProtocol;
  url: string;
  proto?: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  config?: import('./api-protocol-config').ResolvedProtocolConfig;
}

export type AgentProtocolReply = { response: ProtocolResponse } | { error: string };
