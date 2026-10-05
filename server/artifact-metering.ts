import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { and, eq, sql } from 'drizzle-orm';
import { organizations, quotaArtifacts, testPlanExecutions } from '@shared/schema';
import { privilegedDb, withArtifactLock } from './db';
import { getTenantOrgId, runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { quotaUsage, quotasFor, QuotaError } from './tenant-quotas';
import type { ArtifactStore } from './artifact-store';

const rawStores = new WeakMap<ArtifactStore, ArtifactStore>();

/** A report keeps links only to committed evidence; unmeasured terminal legacy runs stay readable. */
export async function executionArtifactAvailability(organizationId: number, planId: string, executionId: string): Promise<(relative: string) => boolean> {
  const prefix = `results/${planId}/${executionId}/`;
  return runWithTenant(organizationId, () => withTenantTransaction(async tx => {
    const [org] = await tx.select({ reconciled: organizations.artifactsReconciledAt }).from(organizations).where(eq(organizations.id, organizationId));
    const [run] = await tx.select({ status: testPlanExecutions.status, artifactStatus: testPlanExecutions.artifactStorageStatus })
      .from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
    const entries = await tx.select({ key: quotaArtifacts.key, reservationId: quotaArtifacts.reservationId }).from(quotaArtifacts)
      .where(and(eq(quotaArtifacts.organizationId, organizationId), sql`${quotaArtifacts.key} LIKE ${prefix.replace(/[\\%_]/g, '\\$&') + '%'}`));
    const committed = new Set(entries.filter(item => item.reservationId === null).map(item => item.key));
    const legacy = !org?.reconciled && run && !run.artifactStatus && !['queued', 'running', 'cancelling'].includes(run.status);
    return relative => committed.has(prefix + relative) || !!legacy;
  }));
}
function safeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').some(p => !p || p === '..')) throw new Error('Invalid artifact key');
  return normalized;
}
async function organizationFor(key: string): Promise<number | null> {
  const baseline = /^visual-baselines\/org_(\d+)\//.exec(key);
  let organizationId = baseline ? Number(baseline[1]) : null;
  const execution = /^results\/([^/]+)\/([^/]+)\//.exec(key);
  if (execution) {
    const [row] = await privilegedDb.select({ organizationId: testPlanExecutions.organizationId }).from(testPlanExecutions)
      .where(and(eq(testPlanExecutions.testPlanId, execution[1]), eq(testPlanExecutions.id, execution[2])));
    organizationId = row?.organizationId ?? null;
  }
  const ambient = getTenantOrgId();
  if (organizationId !== null && ambient !== undefined && ambient !== organizationId) throw new Error('Artifact belongs to another organization');
  return organizationId;
}

async function meteredWrite(raw: ArtifactStore, organizationId: number, key: string, body: Buffer, contentType?: string): Promise<void> {
  const token = randomUUID();
  await runWithTenant(organizationId, () => withTenantTransaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7304,${organizationId})`);
    const [current] = await tx.select().from(quotaArtifacts).where(eq(quotaArtifacts.key, key));
    if (current?.reservationId) throw new Error('An interrupted artifact write requires reconciliation before retry.');
    const [limits, usage] = await Promise.all([quotasFor(tx, organizationId), quotaUsage(tx, organizationId)]);
    const growth = Math.max(0, body.length - (current?.bytes ?? 0));
    if (limits.mode === 'enforce' && limits.maxArtifactBytes > 0) {
      if (!usage.artifactsReconciledAt) throw new Error('Artifact inventory must be reconciled before enforcing storage limits.');
      if (growth > 0 && usage.artifactBytes + usage.reservedArtifactBytes + growth > limits.maxArtifactBytes)
        throw new QuotaError('artifact_quota_exceeded', 'artifact_bytes', usage.artifactBytes + usage.reservedArtifactBytes, limits.maxArtifactBytes);
    }
    await tx.insert(quotaArtifacts).values({ organizationId, key, reservedBytes: growth, reservationId: token })
      .onConflictDoUpdate({ target: [quotaArtifacts.organizationId, quotaArtifacts.key], set: { reservedBytes: growth, reservationId: token, updatedAt: new Date() } });
  }));
  // On ambiguous errors the reservation stays: the object might exist despite a lost reply.
  await raw.write(key, body, contentType);
  await runWithTenant(organizationId, () => withTenantTransaction(tx => tx.update(quotaArtifacts)
    .set({ bytes: body.length, reservedBytes: 0, reservationId: null, updatedAt: new Date() })
    .where(and(eq(quotaArtifacts.key, key), eq(quotaArtifacts.reservationId, token))).returning()));
}

async function available(organizationId: number, key: string): Promise<boolean> {
  return runWithTenant(organizationId, () => withTenantTransaction(async tx => {
    const [org] = await tx.select({ reconciled: organizations.artifactsReconciledAt }).from(organizations).where(eq(organizations.id, organizationId));
    const [row] = await tx.select().from(quotaArtifacts).where(eq(quotaArtifacts.key, key));
    // Unmeasured legacy evidence remains readable until its first successful inventory.
    if (row) return row.reservationId === null;
    if (org?.reconciled) return false;
    const execution = /^results\/([^/]+)\/([^/]+)\//.exec(key);
    if (execution) {
      const [run] = await tx.select({ status: testPlanExecutions.status, artifactStatus: testPlanExecutions.artifactStorageStatus })
        .from(testPlanExecutions).where(and(eq(testPlanExecutions.id, execution[2]), eq(testPlanExecutions.organizationId, organizationId)));
      if (run && (run.artifactStatus || ['queued', 'running', 'cancelling'].includes(run.status))) return false;
    }
    return true;
  }));
}

export function meterArtifactStore(raw: ArtifactStore): ArtifactStore {
  const store: ArtifactStore = {
    kind: raw.kind,
    list: raw.list?.bind(raw),
    async read(input) {
      const key = safeKey(input);
      const org = await organizationFor(key);
      if (org !== null && !await available(org, key)) return null;
      return raw.read(key);
    },
    async open(input) {
      const key = safeKey(input);
      const org = await organizationFor(key);
      if (org !== null && !await available(org, key)) return null;
      return raw.open(key);
    },
    async write(input, body, contentType) {
      const key = safeKey(input);
      const org = await organizationFor(key);
      if (org === null) throw new Error('Artifact owner could not be resolved');
      await withArtifactLock(org, () => meteredWrite(raw, org, key, body, contentType));
    },
    async publishDirectory(localDir) {
      const root = path.resolve(localDir);
      const relative = path.relative(process.cwd(), root).replace(/\\/g, '/');
      if (!relative.startsWith('results/')) throw new Error('Artifact directory must be inside results');
      const prefix = safeKey(relative) + '/';
      const org = await organizationFor(prefix);
      if (org === null) throw new Error('Artifact owner could not be resolved');
      return withArtifactLock(org, async () => {
        const files: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          if (!await fs.pathExists(dir)) return;
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile()) files.push(file);
          }
        };
        await walk(root);
        for (const file of files) {
          const key = prefix + path.relative(root, file).replace(/\\/g, '/');
          try { await meteredWrite(raw, org, key, await fs.readFile(file)); }
          catch (error) {
            if (error instanceof QuotaError) {
              // A newly generated, rejected file is staging, not retained evidence.
              const committed = await runWithTenant(org, () => withTenantTransaction(tx => tx.select().from(quotaArtifacts).where(eq(quotaArtifacts.key, key))));
              if (!committed[0]?.bytes) await fs.remove(file);
            }
            throw error;
          }
        }
        if (raw.kind === 's3') await fs.remove(root);
        return files.length;
      });
    },
    async deletePrefix(input) {
      if (!input.endsWith('/')) throw new Error('Artifact prefix must end with /');
      const prefix = safeKey(input.slice(0, -1)) + '/';
      const org = await organizationFor(prefix);
      if (org === null) {
        // Erasure deletes organization rows before removing its physical evidence.
        if (getTenantOrgId() === undefined) throw new Error('Artifact deletion requires an owner context');
        return raw.deletePrefix(prefix);
      }
      return withArtifactLock(org, async () => {
        const count = await raw.deletePrefix(prefix);
        await runWithTenant(org, () => withTenantTransaction(tx => tx.delete(quotaArtifacts)
          .where(sql`${quotaArtifacts.key} LIKE ${prefix.replace(/[\\%_]/g, '\\$&') + '%'}`).returning()));
        return count;
      });
    },
  };
  rawStores.set(store, raw);
  return store;
}

/** An exclusive session lock fences scans from writes/deletes; no SQL transaction spans I/O. */
export async function reconcileOrganizationArtifacts(organizationId: number, store: ArtifactStore): Promise<void> {
  const raw = rawStores.get(store) ?? store;
  if (!raw.list) throw new Error('Artifact store does not support inventory');
  await withArtifactLock(organizationId, async () => {
    const [organization] = await privilegedDb.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId));
    if (!organization) throw new Error('Organization not found');
    const runs = await privilegedDb.select({ id: testPlanExecutions.id, planId: testPlanExecutions.testPlanId, status: testPlanExecutions.status, artifactStatus: testPlanExecutions.artifactStorageStatus }).from(testPlanExecutions).where(eq(testPlanExecutions.organizationId, organizationId));
    const tracked = await privilegedDb.select({ key: quotaArtifacts.key }).from(quotaArtifacts).where(eq(quotaArtifacts.organizationId, organizationId));
    const trackedKeys = new Set(tracked.map(item => item.key));
    const incompletePrefixes = runs.filter(run => run.artifactStatus || ['queued', 'running', 'cancelling'].includes(run.status)).map(run => `results/${run.planId}/${run.id}/`);
    // The ledger outlives report/plan rows. Their objects still occupy storage until removed.
    const prefixes = new Set([`visual-baselines/org_${organizationId}/`, ...runs.map(run => `results/${run.planId}/${run.id}/`),
      ...tracked.flatMap(item => /^results\/[^/]+\/[^/]+\//.exec(item.key)?.[0] ?? [])]);
    const inventory = new Map<string, number>();
    for (const prefix of prefixes) for (const item of await raw.list!(prefix)) {
      if (!item.key.startsWith(prefix) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('Artifact inventory is invalid');
      if (incompletePrefixes.some(incomplete => item.key.startsWith(incomplete)) && !trackedKeys.has(item.key)) continue;
      inventory.set(safeKey(item.key), item.size);
    }
    await privilegedDb.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7304,${organizationId})`);
      await tx.delete(quotaArtifacts).where(eq(quotaArtifacts.organizationId, organizationId));
      for (const [key, bytes] of inventory) await tx.insert(quotaArtifacts).values({ organizationId, key, bytes });
      await tx.execute(sql`INSERT INTO quota_artifacts(organization_id,key,bytes)
        SELECT organization_id,'mobile-inline/org_'||organization_id||'/'||id||'/screenshot',octet_length(screenshot)
        FROM mobile_test_runs WHERE organization_id=${organizationId} AND screenshot IS NOT NULL`);
      await tx.update(organizations).set({ artifactsReconciledAt: new Date() }).where(eq(organizations.id, organizationId));
    });
  });
}
