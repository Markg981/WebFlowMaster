import { beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { privilegedDb } from '../db';
import { agents, bddExecutionProfiles, tests, testVersions } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant } from '../middleware/tenancy';
import { eq } from 'drizzle-orm';
vi.mock('../logger',() => ({default:Promise.resolve({error:vi.fn(),warn:vi.fn(),info:vi.fn(),debug:vi.fn()})}));
let app:express.Express;
let org:number;
let user:number;
const profileId=randomUUID();
const content='Feature: BDD\n  Scenario: Hello\n    Given a greeting';
beforeAll(async () => {
  org=await createTestOrganization('BDD imports');user=await createTestUser(org,'bdd-import-owner');
  await privilegedDb.insert(agents).values({id:randomUUID(),organizationId:org,name:'BDD',pool:'bdd',tokenPrefix:'wfa_',tokenHash:randomUUID(),bddProfiles:[{id:'shop',label:'Shop',provider:'cucumber-js',revision:'rev-1',maxDurationMs:60000}]});
  await privilegedDb.insert(bddExecutionProfiles).values({id:profileId,organizationId:org,name:'Shop',pool:'bdd',operatorProfileId:'shop',revision:'rev-1'});
  const {default:routes}=await import('./tests.routes');
  app=express();app.use(express.json());app.use((req,_res,next) => {
    (req as any).user={id:user,organizationId:org,username:'bdd-import-owner',role:'owner'};
    (req as any).isAuthenticated=() => true;
    runWithTenant(org,next,{userId:user,role:'owner'});
  });app.use(routes);
});
it('imports executable scenarios only with an authorized explicit profile binding',async () => {
  const imported=await request(app).post('/api/tests/import-bundle').send({content,format:'gherkin',bdd:{mode:'cucumber',binding:{id:profileId,revision:'rev-1'}}}).expect(201);
  expect(imported.body.results[0].outcome).toBe('created');
  const [saved]=await privilegedDb.select().from(tests).where(eq(tests.name,'BDD / Hello'));
  expect(saved.bdd).toMatchObject({mode:'cucumber',binding:{id:profileId,revision:'rev-1'}});
  const [version]=await privilegedDb.select().from(testVersions).where(eq(testVersions.testId,saved.id));
  expect(version.bdd).toEqual(saved.bdd);
  const repeated=await request(app).post('/api/tests/import-bundle').send({content,format:'gherkin',bdd:{mode:'cucumber',binding:{id:profileId,revision:'rev-1'}}}).expect(201);
  expect(repeated.body.results[0].outcome).toBe('unchanged');
  const invalid=await request(app).post('/api/tests/import-bundle').send({content:content.replace('Hello','Unauthorized'),format:'gherkin',dryRun:true,bdd:{mode:'cucumber',binding:{id:randomUUID(),revision:'rev-1'}}}).expect(200);
  expect(invalid.body.results[0].outcome).toBe('invalid');
});
it('normalizes saved source into steps atomically and refuses invalid selector or support revision',async () => {
  const bdd={source:content,uri:'test.feature',language:'en',scenarioLine:2,mode:'cucumber',binding:{id:profileId,revision:'rev-1'}};
  const saved=await request(app).post('/api/tests').send({name:'Direct BDD',url:'',sequence:[],elements:[],bdd}).expect(201);
  expect(saved.body.sequence[0].value).toBe('Given a greeting');
  await request(app).put(`/api/tests/${saved.body.id}`).send({bdd:{...bdd,scenarioLine:999}}).expect(400);
  await request(app).put(`/api/tests/${saved.body.id}`).send({bdd:{...bdd,binding:{id:profileId,revision:'wrong'}}}).expect(400);
  await request(app).put(`/api/tests/${saved.body.id}`).send({sequence:[{action:{id:'click'},value:'#override'}]}).expect(400);
  await request(app).put(`/api/tests/${saved.body.id}/steps/${saved.body.sequence[0].id}/selector`).send({selector:'#override'}).expect(409);
});
