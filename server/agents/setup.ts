import type { Server } from 'http';
import os from 'os';
import { randomUUID } from 'crypto';
import loggerPromise from '../logger';
import { authenticateAgentToken, recordAgentSeen } from './agent-auth';
import { relaySecret } from './agent-credentials';
import { AgentRelay, setAgentRelay, type RelayCluster } from './relay';
import { RedisRelayDirectory } from './relay-directory';

/**
 * Whether this web server is one of several relay instances, and how the others reach it.
 *
 * AGENT_RELAY_ADVERTISE_URL is this instance's own address as the other instances see it (a pod
 * IP, a container name), never the load balancer's. Unset, the relay is the only one, which is
 * right for a single web server and needs no Redis.
 */
export async function relayCluster(env: NodeJS.ProcessEnv = process.env): Promise<RelayCluster | undefined> {
  const url = env.AGENT_RELAY_ADVERTISE_URL?.trim();
  if (!url) return undefined;
  const { connection } = await import('../redis');
  return {
    directory: new RedisRelayDirectory(connection),
    instanceId: `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    url,
  };
}

/** Starts this web server's agent relay, on the same address and port as everything else. */
export async function setupAgentRelay(server: Server): Promise<AgentRelay> {
  const logger = await loggerPromise;
  // Throttled: a heartbeat every twenty seconds per agent does not need a write every time.
  const lastWrite = new Map<string, number>();
  const cluster = await relayCluster();
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
    cluster,
    log: (level, message, meta) => logger[level]({ message, ...meta }),
  });
  if (cluster) logger.info({ message: 'Agent relay runs as one of several instances', instanceId: cluster.instanceId, advertisedAt: cluster.url });
  relay.attach(server);
  setAgentRelay(relay);
  return relay;
}
