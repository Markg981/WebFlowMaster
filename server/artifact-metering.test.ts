import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { privilegedDb } from './db';
import { createTestOrganization, createTestUser } from './tests/factories';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { createLocalArtifactStore } from './artifact-store';
import { quotaUsage } from './tenant-quotas';

let org: number;
let directory: string;
beforeEach(async () => {
  org = await createTestOrganization('Storage quota');
  directory = await mkdtemp(path.join(tmpdir(), 'wfm-quota-'));
  await privilegedDb.execute(sql`UPDATE organizations SET max_artifact_bytes=12,artifacts_reconciled_at=now() WHERE id=${org}`);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const asOrg = <T>(work: () => Promise<T>) => runWithTenant(org, work);
const usage = () => asOrg(() => withTenantTransaction(tx => quotaUsage(tx, org)));

describe('retained artifact bytes', () => {
  it('filters rejected report evidence while keeping successfully committed images available', async () => {
    const { executionArtifactAvailability } = await import('./artifact-metering');
    const { artifactUrl, stepsWithArtifactUrls } = await import('./routes/artifacts.routes');
    const user = await createTestUser(org);
    const plan = 'report-plan-' + org;
    const run = 'report-run-' + org;
    await privilegedDb.execute(sql`INSERT INTO test_plans(id,name,user_id,organization_id) VALUES (${plan},'Report',${user},${org})`);
    await privilegedDb.execute(sql`INSERT INTO test_plan_executions(id,test_plan_id,organization_id,status,triggered_by,artifact_storage_status) VALUES (${run},${plan},${org},'completed','manual','quota_exceeded')`);
    const kept = `results/${plan}/${run}/kept.png`;
    const rejected = `results/${plan}/${run}/rejected.png`;
    await privilegedDb.execute(sql`INSERT INTO quota_artifacts(organization_id,key,bytes) VALUES (${org},${kept},10)`);
    const available = await asOrg(() => executionArtifactAvailability(org, plan, run));
    expect(artifactUrl(run, kept, available)).toBeTruthy();
    expect(artifactUrl(run, rejected, available)).toBeNull();
    const steps = stepsWithArtifactUrls(run, JSON.stringify([{ name: 'Evidence', screenshot: rejected, visual: { baselineImage: kept, actualImage: rejected } }]), available);
    expect(steps[0]).toMatchObject({ screenshot: null, evidenceUnavailable: true, visual: { actualImage: null } });
    expect(steps[0].visual?.baselineImage).toBeTruthy();
  });
  it('keeps physically retained evidence counted after its plan and report rows are deleted', async () => {
    const { reconcileOrganizationArtifacts, meterArtifactStore } = await import('./artifact-metering');
    const user = await createTestUser(org);
    const plan = 'deleted-plan-' + org;
    const run = 'deleted-run-' + org;
    await privilegedDb.execute(sql`INSERT INTO test_plans(id,name,user_id,organization_id) VALUES (${plan},'Deleted',${user},${org})`);
    await privilegedDb.execute(sql`INSERT INTO test_plan_executions(id,test_plan_id,organization_id,status,triggered_by) VALUES (${run},${plan},${org},'completed','manual')`);
    const raw = createLocalArtifactStore(directory);
    await asOrg(() => meterArtifactStore(raw).write(`results/${plan}/${run}/evidence.png`, Buffer.alloc(10)));
    await privilegedDb.execute(sql`DELETE FROM test_plans WHERE id=${plan}`);
    await reconcileOrganizationArtifacts(org, raw);
    expect((await usage()).artifactBytes).toBe(10);
  });
  it('does not turn active execution staging into retained evidence during inventory', async () => {
    const { reconcileOrganizationArtifacts, meterArtifactStore } = await import('./artifact-metering');
    const user = await createTestUser(org);
    const plan = 'staging-plan-' + org;
    const run = 'staging-run-' + org;
    await privilegedDb.execute(sql`INSERT INTO test_plans(id,name,user_id,organization_id) VALUES (${plan},'Staging',${user},${org})`);
    await privilegedDb.execute(sql`INSERT INTO test_plan_executions(id,test_plan_id,organization_id,status,triggered_by) VALUES (${run},${plan},${org},'running','manual')`);
    const raw = createLocalArtifactStore(directory);
    await raw.write(`results/${plan}/${run}/pending.png`, Buffer.alloc(10));
    await privilegedDb.execute(sql`UPDATE organizations SET artifacts_reconciled_at=NULL WHERE id=${org}`);
    expect(await asOrg(() => meterArtifactStore(raw).read(`results/${plan}/${run}/pending.png`))).toBeNull();
    await reconcileOrganizationArtifacts(org, raw);
    expect((await usage()).artifactBytes).toBe(0);
  });
  it('counts inline mobile evidence and preserves the test verdict and previous image at the cap', async () => {
    const test = await privilegedDb.execute(sql`INSERT INTO mobile_tests(organization_id,name,platform,app,device_name) VALUES (${org},'Phone','android','app.apk','Pixel') RETURNING id`);
    const testId = Number(test.rows[0].id);
    await asOrg(() => withTenantTransaction(tx => tx.execute(sql`INSERT INTO mobile_test_runs(id,organization_id,mobile_test_id,status,device,screenshot) VALUES ('mobile-evidence',${org},${testId},'passed','Pixel','1234567890')`)));
    expect((await usage()).artifactBytes).toBe(10);
    const changed = await asOrg(() => withTenantTransaction(tx => tx.execute(sql`UPDATE mobile_test_runs SET screenshot='123456789012345' WHERE id='mobile-evidence' RETURNING status,screenshot,artifact_storage_status`)));
    expect(changed.rows[0]).toMatchObject({ status: 'passed', screenshot: '1234567890', artifact_storage_status: 'quota_exceeded' });
    await privilegedDb.execute(sql`DELETE FROM mobile_tests WHERE id=${testId}`);
    expect((await usage()).artifactBytes).toBe(0);
  });
  it('counts replacements by their growth delta and releases bytes after deletion', async () => {
    const { meterArtifactStore } = await import('./artifact-metering');
    const store = meterArtifactStore(createLocalArtifactStore(directory));
    const key = `visual-baselines/org_${org}/test_1/a.png`;
    await asOrg(() => store.write(key, Buffer.alloc(10)));
    await asOrg(() => store.write(key, Buffer.alloc(11)));
    expect((await usage()).artifactBytes).toBe(11);
    await expect(asOrg(() => store.write(`visual-baselines/org_${org}/test_1/b.png`, Buffer.alloc(2))))
      .rejects.toMatchObject({ code: 'artifact_quota_exceeded' });
    expect((await usage()).reservedArtifactBytes).toBe(0);
    await asOrg(() => store.deletePrefix(`visual-baselines/org_${org}/test_1/`));
    expect((await usage()).artifactBytes).toBe(0);
  });
  it('retains an ambiguous reservation until successful reconciliation', async () => {
    const { meterArtifactStore, reconcileOrganizationArtifacts } = await import('./artifact-metering');
    const raw = createLocalArtifactStore(directory);
    const write = raw.write;
    raw.write = async (key, body) => { await write(key, body); throw new Error('Lost storage response'); };
    const store = meterArtifactStore(raw);
    await expect(asOrg(() => store.write(`visual-baselines/org_${org}/test_1/a.png`, Buffer.alloc(10)))).rejects.toThrow('Lost storage response');
    expect((await usage()).reservedArtifactBytes).toBe(10);
    await reconcileOrganizationArtifacts(org, raw);
    expect((await usage()).artifactBytes).toBe(10);
    expect((await usage()).reservedArtifactBytes).toBe(0);
  });
  it('monitor allows overage and legacy objects are measured rather than assumed empty', async () => {
    const { meterArtifactStore, reconcileOrganizationArtifacts } = await import('./artifact-metering');
    const raw = createLocalArtifactStore(directory);
    await raw.write(`visual-baselines/org_${org}/test_1/legacy.png`, Buffer.alloc(15));
    await privilegedDb.execute(sql`UPDATE organizations SET quota_mode='monitor',artifacts_reconciled_at=NULL WHERE id=${org}`);
    await reconcileOrganizationArtifacts(org, raw);
    const store = meterArtifactStore(raw);
    await asOrg(() => store.write(`visual-baselines/org_${org}/test_1/new.png`, Buffer.alloc(5)));
    expect((await usage()).artifactBytes).toBe(20);
  });
});
