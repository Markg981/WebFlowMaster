import { and, eq, isNull } from 'drizzle-orm';
import { agents, bddExecutionProfiles, projects } from '@shared/schema';
import type { BddTest } from '@shared/bdd';
import { BddAgentProfileSchema } from '@shared/bdd-agent';
import { agentRelay } from './agents/relay';
import type { TenantTx } from './middleware/tenancy';

export async function advertisedBddProfiles(tx: TenantTx) {
  const hosts = await tx.select({ id: agents.id, pool: agents.pool, profiles: agents.bddProfiles }).from(agents).where(isNull(agents.revokedAt));
  const choices = new Map<string, { pool: string; connected: boolean } & import('@shared/bdd-agent').BddAgentProfile>();
  for (const host of hosts) {
    if (!Array.isArray(host.profiles)) continue;
    for (const raw of host.profiles.slice(0, 100)) {
      const parsed = BddAgentProfileSchema.safeParse(raw);
      if (!parsed.success) continue;
      const value = { ...parsed.data, pool: host.pool, connected: agentRelay()?.isConnected(host.id) ?? false };
      const key = `${host.pool}:${value.id}:${value.revision}`;
      const prior = choices.get(key);
      choices.set(key, { ...value, maxDurationMs: Math.min(prior?.maxDurationMs ?? value.maxDurationMs, value.maxDurationMs), connected: Boolean(prior?.connected || value.connected) });
    }
  }
  return [...choices.values()];
}

export async function validateBddProfileDefinition(tx: TenantTx, input: { projectId?: number | null; pool: string; operatorProfileId: string; revision: string; timeoutMs: number }) {
  if (input.projectId != null) {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new Error('The project is not available in this organization.');
  }
  const profile = (await advertisedBddProfiles(tx)).find(p => p.pool === input.pool && p.id === input.operatorProfileId && p.revision === input.revision);
  if (!profile) throw new Error('No authorized agent advertises this support profile and revision.');
  if (input.timeoutMs > profile.maxDurationMs) throw new Error('The requested duration exceeds the operator profile limit.');
}

export async function resolveBddBinding(tx: TenantTx, bdd: BddTest, projectId: number | null) {
  if (bdd.mode !== 'cucumber') return undefined;
  if (!bdd.binding) throw new Error('Cucumber execution requires an authorized profile.');
  const [profile] = await tx.select().from(bddExecutionProfiles).where(and(eq(bddExecutionProfiles.id, bdd.binding.id), eq(bddExecutionProfiles.revision, bdd.binding.revision))).limit(1);
  if (!profile || (profile.projectId != null && profile.projectId !== projectId)) throw new Error('The BDD profile is unavailable for this test project or support revision.');
  await validateBddProfileDefinition(tx, profile);
  return profile;
}
