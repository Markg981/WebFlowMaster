import {beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {privilegedDb} from '../db';
import {createTestOrganization,createTestUser} from './factories';
import {runWithTenant,withTenantTransaction} from '../middleware/tenancy';
let org:number,foreign:number,owner:number,other:number;
const id=randomUUID();
beforeAll(async () => {
  org=await createTestOrganization('BDD isolation');foreign=await createTestOrganization('Other BDD');
  owner=await createTestUser(org);other=await createTestUser(foreign);
  await privilegedDb.execute(sql`INSERT INTO bdd_execution_profiles(id,organization_id,name,pool,operator_profile_id,revision) VALUES(${id},${org},'BDD','bdd','shop','rev-1')`);
});
it('hides profiles across organizations and refuses editor or cross-tenant writes at the database boundary',async () => {
  await runWithTenant(foreign,() => withTenantTransaction(async tx => {
    expect((await tx.execute(sql`SELECT id FROM bdd_execution_profiles WHERE id=${id}`)).rows).toHaveLength(0);
    expect((await tx.execute(sql`DELETE FROM bdd_execution_profiles WHERE id=${id} RETURNING id`)).rows).toHaveLength(0);
  }),{userId:other,role:'owner'});
  await runWithTenant(org,() => withTenantTransaction(async tx => {
    expect((await tx.execute(sql`SELECT id FROM bdd_execution_profiles WHERE id=${id}`)).rows).toEqual([{id}]);
    expect((await tx.execute(sql`UPDATE bdd_execution_profiles SET revision='tampered' WHERE id=${id} RETURNING id`)).rows).toHaveLength(0);
  }),{userId:owner,role:'editor'});
  await expect(runWithTenant(foreign,() => withTenantTransaction(tx => tx.execute(sql`INSERT INTO bdd_execution_profiles(id,organization_id,name,pool,operator_profile_id,revision) VALUES(${randomUUID()},${org},'Wrong','bdd','shop','rev-1')`)),{userId:other,role:'owner'})).rejects.toMatchObject({code:'42501'});
});
it('allows organization owners to update the pinned profile and rejects invalid execution limits',async () => {
  await runWithTenant(org,() => withTenantTransaction(async tx => {
    expect((await tx.execute(sql`UPDATE bdd_execution_profiles SET revision='rev-2' WHERE id=${id} RETURNING revision`)).rows).toEqual([{revision:'rev-2'}]);
  }),{userId:owner,role:'owner'});
  await expect(privilegedDb.execute(sql`UPDATE bdd_execution_profiles SET timeout_ms=300001 WHERE id=${id}`)).rejects.toMatchObject({code:'23514'});
});
it('follows restricted project membership and forbids reassignment to another organization project',async () => {
  const project=(await privilegedDb.execute(sql`INSERT INTO projects(name,user_id,organization_id,restricted) VALUES('BDD restricted',${owner},${org},true) RETURNING id`)).rows[0] as {id:number};
  const foreignProject=(await privilegedDb.execute(sql`INSERT INTO projects(name,user_id,organization_id) VALUES('Foreign',${other},${foreign}) RETURNING id`)).rows[0] as {id:number};
  const scoped=randomUUID();
  await privilegedDb.execute(sql`INSERT INTO bdd_execution_profiles(id,organization_id,project_id,name,pool,operator_profile_id,revision) VALUES(${scoped},${org},${project.id},'Restricted','bdd','shop','rev-1')`);
  const viewer=await createTestUser(org);
  const visible=() => withTenantTransaction(tx => tx.execute(sql`SELECT id FROM bdd_execution_profiles WHERE id=${scoped}`));
  expect((await runWithTenant(org,visible,{userId:viewer,role:'viewer'})).rows).toHaveLength(0);
  await privilegedDb.execute(sql`INSERT INTO project_members(project_id,user_id,organization_id,role) VALUES(${project.id},${viewer},${org},'viewer')`);
  expect((await runWithTenant(org,visible,{userId:viewer,role:'viewer'})).rows).toEqual([{id:scoped}]);
  await expect(runWithTenant(org,() => withTenantTransaction(tx => tx.execute(sql`UPDATE bdd_execution_profiles SET project_id=${foreignProject.id} WHERE id=${scoped}`)),{userId:owner,role:'owner'})).rejects.toMatchObject({code:'42501'});
  await privilegedDb.execute(sql`DELETE FROM projects WHERE id=${project.id}`);
  expect((await runWithTenant(org,visible,{userId:owner,role:'owner'})).rows).toHaveLength(0);
});
