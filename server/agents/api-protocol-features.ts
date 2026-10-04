import type { AgentApiFeature, AgentProtocolRequest } from '@shared/agent-protocol';
import { grpcModeFor } from '../grpc-protocol';

/** Signed capability requirements contain feature names, never target credentials. */
export async function requiredApiFeatures(
  request: AgentProtocolRequest,
): Promise<AgentApiFeature[]> {
  if (request.config != null) return ['native-protocol-v2'];
  if (request.protocol === 'grpc')
    return (await grpcModeFor(request.proto ?? '', new URL(request.url))) !== 'unary'
      ? ['native-protocol-v2']
      : [];
  try {
    const body = JSON.parse(request.body);
    if (body && Array.isArray(body.steps)) return ['native-protocol-v2'];
  } catch {
    /* A plain legacy WebSocket message. */
  }
  return [];
}
