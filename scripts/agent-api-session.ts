import WebSocket from 'ws';
import type { AgentApiProtocol, AgentApiFeature, AgentProtocolRequest, AgentProtocolReply } from '../shared/agent-protocol';
import { ResolvedProtocolConfigSchema } from '../shared/api-protocol-config';
import { requiredApiFeatures } from '../server/agents/api-protocol-features';
import { runGrpc, runWebSocket } from '../server/api-network-protocols';

/** One native request on a session the authenticated relay assigned to this agent. */
export function serveApiSession(socket: WebSocket, protocol: AgentApiProtocol, done: () => void, authorizedFeatures: AgentApiFeature[] = []): void {
  const abort = new AbortController();
  // A 60s handshake/deadline plus up to 60s of WebSocket collection, and a small margin.
  const timer = setTimeout(() => socket.terminate(), 125_000);
  socket.once('close', () => {
    clearTimeout(timer);
    abort.abort();
    done();
  });
  socket.on('error', () => socket.terminate());
  socket.once('message', (raw) => {
    void (async () => {
      let reply: AgentProtocolReply;
      try {
        const request = JSON.parse(raw.toString()) as AgentProtocolRequest;
        const url = new URL(request.url);
        if (request.protocol !== protocol || !(protocol === 'grpc' ? ['grpc:', 'grpcs:'] : ['ws:', 'wss:']).includes(url.protocol)) {
          throw new Error('The API request does not match the protocol authorized by the relay.');
        }
        if (typeof request.body !== 'string' || !request.headers || typeof request.headers !== 'object' ||
          !Object.values(request.headers).every((value) => typeof value === 'string') ||
          !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 60_000) {
          throw new Error('Invalid agent API request.');
        }
        const config = request.config == null ? undefined : ResolvedProtocolConfigSchema.parse(request.config);
        const required = await requiredApiFeatures(request);
        if (!required.every(feature => authorizedFeatures.includes(feature))) throw new Error('The API request needs features not authorized by the relay ticket.');
        const input = { headers: request.headers, body: request.body, timeoutMs: request.timeoutMs, signal: abort.signal, config };
        const response = protocol === 'grpc'
          ? await runGrpc({ ...input, url, proto: request.proto ?? '' })
          : await runWebSocket({ ...input, url: url.toString() });
        reply = { response };
      } catch (error) {
        reply = { error: (error as Error).message };
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply), () => socket.close());
    })();
  });
}
