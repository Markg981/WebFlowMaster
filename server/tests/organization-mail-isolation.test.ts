import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from './factories';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';
let org: number; let foreign: number; let owner: number; let outsider: number;
beforeAll(async () => {
  org = await createTestOrganization(); foreign = await createTestOrganization();
  owner = await createTestUser(org); outsider = await createTestUser(foreign);
  await privilegedDb.execute(sql`INSERT INTO organization_mail_settings(organization_id,smtp_mode) VALUES (${org},'disabled')`);
  await privilegedDb.execute(sql`INSERT INTO organization_mail_templates(organization_id,purpose,subject,html,text) VALUES (${org},'run_finished','Organization secret title','<p>Organization</p>','Organization')`);
});
describe('organization SMTP and template database isolation', () => {
  it('allows owners in the current organization to edit configuration and templates', async () => {
    await runWithTenant(org, () => withTenantTransaction(async tx => {
      expect((await tx.execute(sql`SELECT organization_id FROM organization_mail_settings`)).rows).toEqual([{ organization_id: org }]);
      expect((await tx.execute(sql`UPDATE organization_mail_templates SET subject='Updated' WHERE organization_id=${org} RETURNING purpose`)).rows).toHaveLength(1);
    }), { userId: owner, role: 'owner' });
  });
  it('hides credentials and template content from viewers/editors and other organizations', async () => {
    for (const principal of [{ id: owner, org, role: 'viewer' }, { id: owner, org, role: 'editor' }, { id: outsider, org: foreign, role: 'owner' }]) {
      await runWithTenant(principal.org, () => withTenantTransaction(async tx => {
        expect((await tx.execute(sql`SELECT * FROM organization_mail_settings`)).rows).toHaveLength(0);
        expect((await tx.execute(sql`SELECT * FROM organization_mail_templates`)).rows).toHaveLength(0);
        expect((await tx.execute(sql`UPDATE organization_mail_settings SET smtp_mode='inherit' WHERE organization_id=${org} RETURNING organization_id`)).rows).toHaveLength(0);
      }), { userId: principal.id, role: principal.role });
    }
  });
  it('rejects cross-tenant inserts and invalid provider/revision values at the database boundary', async () => {
    await expect(runWithTenant(foreign, () => withTenantTransaction(tx => tx.execute(sql`INSERT INTO organization_mail_settings(organization_id) VALUES (${org})`)), { userId: outsider, role: 'owner' })).rejects.toMatchObject({ code: '42501' });
    await expect(privilegedDb.execute(sql`UPDATE organization_mail_settings SET provider='unknown' WHERE organization_id=${org}`)).rejects.toMatchObject({ code: '23514' });
    await expect(privilegedDb.execute(sql`UPDATE organization_mail_templates SET version=0 WHERE organization_id=${org}`)).rejects.toMatchObject({ code: '23514' });
  });
});
