import { and, eq, isNull } from 'drizzle-orm';
import { agents, type Agent } from '@shared/schema';
import type { AgentHello } from '@shared/agents';
import { privilegedDb } from '../db';
import { hashAgentToken } from './agent-credentials';

/**
 * Which agent a token belongs to, and what it reported about itself.
 *
 * Privileged, like an API key's lookup (middleware/api-key-auth.ts): the token is what says
 * which organization the connection is for, so the lookup cannot run inside one. Nothing else the
 * agent does touches the database. It only borrows browsers, and the runner that drives them is
 * inside its own tenant context.
 */

export async function authenticateAgentToken(token: string | undefined | null): Promise<Agent | null> {
  if (!token) return null;
  const [agent] = await privilegedDb
    .select()
    .from(agents)
    .where(and(eq(agents.tokenHash, hashAgentToken(token)), isNull(agents.revokedAt)))
    .limit(1);
  return agent ?? null;
}

/** Stamped when it connects, and every so often while it stays connected. */
export async function recordAgentSeen(agentId: string, hello?: Pick<AgentHello, 'hostname' | 'agentVersion' | 'playwrightVersion' | 'browsers'>): Promise<void> {
  await privilegedDb
    .update(agents)
    .set({
      lastSeenAt: new Date(),
      ...(hello
        ? { hostname: hello.hostname, agentVersion: hello.agentVersion, playwrightVersion: hello.playwrightVersion, browsers: hello.browsers }
        : {}),
    })
    .where(eq(agents.id, agentId));
}
