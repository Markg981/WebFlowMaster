import type { Server } from 'http';
import loggerPromise from '../logger';
import { authenticateAgentToken, recordAgentSeen } from './agent-auth';
import { relaySecret } from './agent-credentials';
import { AgentRelay, setAgentRelay } from './relay';

/** Starts this web server's agent relay, on the same address and port as everything else. */
export async function setupAgentRelay(server: Server): Promise<AgentRelay> {
  const logger = await loggerPromise;
  // Throttled: a heartbeat every twenty seconds per agent does not need a write every time.
  const lastWrite = new Map<string, number>();
  const relay = new AgentRelay({
    authenticate: async (token) => {
      const agent = await authenticateAgentToken(token);
      return agent ? { id: agent.id, organizationId: agent.organizationId, pool: agent.pool, name: agent.name } : null;
    },
    onSeen: async (agentId, hello) => {
      const now = Date.now();
      if (!hello && now - (lastWrite.get(agentId) ?? 0) < 55_000) return;
      lastWrite.set(agentId, now);
      await recordAgentSeen(agentId, hello).catch((error) =>
        logger.warn({ message: 'Could not record a local agent as seen', agentId, error: error?.message }),
      );
    },
    secret: () => relaySecret(),
    log: (level, message, meta) => logger[level]({ message, ...meta }),
  });
  relay.attach(server);
  setAgentRelay(relay);
  return relay;
}
