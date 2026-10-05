import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { createTestOrganization, createTestUser } from './tests/factories';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { defaultQuotas } from './tenant-quotas';

let org: number;
let user: number;
beforeEach(async () => {
  org = await createTestOrganization('Quota team');
  user = await createTestUser(org);
});
const asOrg = <T>(id: number, work: () => Promise<T>) => runWithTenant(id, work);
const insert = (kind: 'ui' | 'api' | 'mobile', id = org, author = user) => asOrg(id, () => withTenantTransaction(async tx => {
  if (kind === 'ui') return tx.execute(sql`INSERT INTO tests (organization_id,user_id,name,url,sequence,elements) VALUES (${id},${author},'UI','https://example.com','[]','[]')`);
  if (kind === 'api') return tx.execute(sql`INSERT INTO api_tests (organization_id,user_id,name,method,url) VALUES (${id},${author},'API','GET','https://example.com')`);
  return tx.execute(sql`INSERT INTO mobile_tests (organization_id,created_by,name,platform,app,device_name,steps) VALUES (${id},${author},'Mobile','android','app.apk','Pixel','[]')`);
}));

describe('configurable quota metering', () => {
  it('keeps all new dimensions unlimited by default and validates environment values', () => {
    expect(defaultQuotas({})).toMatchObject({ mode: 'enforce', maxTests: 0, maxArtifactBytes: 0, maxMonthlyExecutionMinutes: 0 });
    expect(defaultQuotas({ TENANT_QUOTA_MODE: 'monitor', ORG_MAX_TESTS: '4', ORG_MAX_ARTIFACT_BYTES: '9007199254740992' }))
      .toMatchObject({ mode: 'monitor', maxTests: 4, maxArtifactBytes: 0 });
  });
  it('enforces one test limit across all types and keeps another organization independent', async () => {
    await privilegedDb.execute(sql`UPDATE organizations SET max_tests = 1 WHERE id = ${org}`);
    await insert('ui');
    await expect(insert('api')).rejects.toMatchObject({ code: 'P0001', message: 'test_quota_exceeded' });
    await expect(insert('mobile')).rejects.toMatchObject({ code: 'P0001', message: 'test_quota_exceeded' });
    const other = await createTestOrganization('Other quota team');
    await insert('api', other, await createTestUser(other));
    await asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`DELETE FROM tests WHERE organization_id = ${org}`)));
    await insert('mobile');
  });
  it('monitor and off never refuse creations even with finite limits', async () => {
    await privilegedDb.execute(sql`UPDATE organizations SET max_tests = 1, quota_mode = 'monitor' WHERE id = ${org}`);
    await insert('ui'); await insert('api');
    await privilegedDb.execute(sql`UPDATE organizations SET quota_mode = 'off' WHERE id = ${org}`);
    await insert('mobile');
    const result = await asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`SELECT * FROM app_quota_usage()`)));
    expect(Number(result.rows[0].tests)).toBe(3);
  });
  it('rolls back an over-limit batch instead of retaining the first rows', async () => {
    await privilegedDb.execute(sql`UPDATE organizations SET max_tests = 1 WHERE id = ${org}`);
    await expect(asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`INSERT INTO api_tests (organization_id,user_id,name,method,url) VALUES (${org},${user},'One','GET','https://example.com'),(${org},${user},'Two','GET','https://example.com')`))))
      .rejects.toMatchObject({ message: 'test_quota_exceeded' });
    const result = await asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`SELECT * FROM app_quota_usage()`)));
    expect(Number(result.rows[0].tests)).toBe(0);
  });
  it('admits exactly one concurrent creator at the final slot', async () => {
    await privilegedDb.execute(sql`UPDATE organizations SET max_tests = 1 WHERE id = ${org}`);
    const results = await Promise.allSettled([insert('api'), insert('mobile')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });
  it('counts restricted project tests even when the requester cannot see their rows', async () => {
    await privilegedDb.execute(sql`UPDATE organizations SET max_tests=1 WHERE id=${org}`);
    const project = await privilegedDb.execute(sql`INSERT INTO projects(organization_id,user_id,name,restricted) VALUES (${org},${user},'Private',true) RETURNING id`);
    await privilegedDb.execute(sql`INSERT INTO tests(organization_id,user_id,project_id,name,url,sequence,elements) VALUES (${org},${user},${Number(project.rows[0].id)},'Hidden','https://example.com','[]','[]')`);
    await runWithTenant(org, async () => {
      const visible = await withTenantTransaction(tx => tx.execute(sql`SELECT id FROM tests WHERE organization_id=${org}`));
      expect(visible.rows).toHaveLength(0);
      const used = await withTenantTransaction(tx => tx.execute(sql`SELECT * FROM app_quota_usage()`));
      expect(Number(used.rows[0].tests)).toBe(1);
      await expect(withTenantTransaction(tx => tx.execute(sql`INSERT INTO api_tests(organization_id,user_id,name,method,url) VALUES (${org},${user},'Public','GET','https://example.com')`)))
        .rejects.toMatchObject({ message: 'test_quota_exceeded' });
    }, { userId: user, role: 'editor' });
  });
  it('does not let the application alter its limits, installation defaults, or another tenant', async () => {
    await expect(asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`UPDATE organizations SET max_tests=0 WHERE id=${org}`))))
      .rejects.toMatchObject({ code: '42501' });
    await expect(asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`UPDATE quota_installation_defaults SET max_tests=0`))))
      .rejects.toMatchObject({ code: '42501' });
    const other = await createTestOrganization('Hidden team');
    await expect(insert('api', other, await createTestUser(other)).then(() =>
      asOrg(org, () => withTenantTransaction(tx => tx.execute(sql`INSERT INTO api_tests(organization_id,user_id,name,method,url) VALUES (${other},${user},'Foreign','GET','https://example.com')`)))))
      .rejects.toMatchObject({ code: '42501' });
  });
});
