export type AgentApiProtocol = 'grpc' | 'websocket';

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
}

export type AgentProtocolReply = { response: ProtocolResponse } | { error: string };
