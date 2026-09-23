import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { testPlanExecutions, testPlans, users } from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { createS3ArtifactStore, type ArtifactStore } from './artifact-store';
import { fakeS3 } from './tests/fake-s3';
import { purgeExpiredArtifacts, retentionDays } from './artifact-retention';

/**
 * Removing the evidence of old runs, and only of old, finished runs.
 *
 * The runs themselves stay: what goes is their screenshots, videos and traces.
 */

const now = new Date('2026-09-24T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

let organizationId: number;
let otherOrganizationId: number;
let planId: string;
let otherPlanId: string;
let client: ReturnType<typeof fakeS3>;
let store: ArtifactStore;

async function run(columns: Record<string, unknown>, plan = planId, org = organizationId) {
  const id = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id, organizationId: org, testPlanId: plan, triggeredBy: 'manual', status: 'completed', ...columns } as any);
  await store.write(`results/${plan}/${id}/ui_1/step.png`, Buffer.from('png'));
  await store.write(`results/${plan}/${id}/ui_1/video.webm`, Buffer.from('webm'));
  return id;
}

const filesOf = (plan: string, id: string) => [...client.objects.keys()].filter((key) => key.startsWith(`results/${plan}/${id}/`));
const rowOf = async (id: string) => (await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id)))[0];

beforeEach(async () => {
  await privilegedDb.delete(testPlanExecutions);
  client = fakeS3();
  store = createS3ArtifactStore({ client, bucket: 'evidence' });
  organizationId = await createTestOrganization('Retention Org');
  otherOrganizationId = await createTestOrganization('Other Retention Org');
  for (const [org, set] of [
    [organizationId, (id: string) => (planId = id)],
    [otherOrganizationId, (id: string) => (otherPlanId = id)],
  ] as const) {
    const [user] = await privilegedDb.insert(users).values({ username: `ret-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: org }).returning();
    const id = uuidv4();
    await privilegedDb.insert(testPlans).values({ id, name: 'Retention', userId: user.id, organizationId: org } as any);
    set(id);
  }
});

describe('retentionDays', () => {
  it('keeps ninety days unless told otherwise, and for ever when told 0', () => {
    expect(retentionDays({} as NodeJS.ProcessEnv)).toBe(90);
    expect(retentionDays({ ARTIFACT_RETENTION_DAYS: '30' } as NodeJS.ProcessEnv)).toBe(30);
    expect(retentionDays({ ARTIFACT_RETENTION_DAYS: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(retentionDays({ ARTIFACT_RETENTION_DAYS: 'soon' } as NodeJS.ProcessEnv)).toBe(90);
  });
});

describe('purgeExpiredArtifacts', () => {
  it('removes the files of runs that ended before the cutoff, in every organization, and keeps the runs', async () => {
    const old = await run({ completedAt: daysAgo(40) });
    const oldElsewhere = await run({ completedAt: daysAgo(40) }, otherPlanId, otherOrganizationId);

    const report = await purgeExpiredArtifacts({ now, days: 30, store });

    expect(report).toEqual({ purgedRuns: 2, removedFiles: 4, failed: [] });
    expect(filesOf(planId, old)).toEqual([]);
    expect(filesOf(otherPlanId, oldElsewhere)).toEqual([]);
    const row = await rowOf(old);
    expect(row.status).toBe('completed');
    expect(row.artifactsPurgedAt).toEqual(now);
  });

  it('leaves recent runs, running runs, and runs already purged alone', async () => {
    const recent = await run({ completedAt: daysAgo(10) });
    const stillRunning = await run({ status: 'running', startedAt: daysAgo(40), completedAt: null });
    const done = await run({ completedAt: daysAgo(40), artifactsPurgedAt: daysAgo(5) });

    const report = await purgeExpiredArtifacts({ now, days: 30, store });

    expect(report.purgedRuns).toBe(0);
    expect(filesOf(planId, recent)).toHaveLength(2);
    expect(filesOf(planId, stillRunning)).toHaveLength(2);
    expect((await rowOf(done)).artifactsPurgedAt).toEqual(daysAgo(5));
  });

  it('keeps everything when retention is 0', async () => {
    const old = await run({ completedAt: daysAgo(4000) });

    expect(await purgeExpiredArtifacts({ now, days: 0, store })).toEqual({ purgedRuns: 0, removedFiles: 0, failed: [] });
    expect(filesOf(planId, old)).toHaveLength(2);
  });

  it('does not mark a run whose files could not be removed, so the next sweep tries again', async () => {
    const old = await run({ completedAt: daysAgo(40) });
    const failing: ArtifactStore = { ...store, deletePrefix: async () => { throw new Error('AccessDenied'); } };

    const report = await purgeExpiredArtifacts({ now, days: 30, store: failing });

    expect(report.failed).toEqual([old]);
    expect((await rowOf(old)).artifactsPurgedAt).toBeNull();
  });

  it('handles at most one batch per sweep, oldest first', async () => {
    const oldest = await run({ completedAt: daysAgo(60) });
    const older = await run({ completedAt: daysAgo(50) });

    const report = await purgeExpiredArtifacts({ now, days: 30, store, batchSize: 1 });

    expect(report.purgedRuns).toBe(1);
    expect((await rowOf(oldest)).artifactsPurgedAt).not.toBeNull();
    expect((await rowOf(older)).artifactsPurgedAt).toBeNull();
  });
});
