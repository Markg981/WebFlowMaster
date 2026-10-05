import { beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { privilegedDb } from '../db';
import { agents, bddExecutionProfiles, projects, tests, testVersions } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant } from '../middleware/tenancy';
import { eq } from 'drizzle-orm';
import { exportBundle } from '../test-bundle';
vi.mock('../logger',() => ({default:Promise.resolve({error:vi.fn(),warn:vi.fn(),info:vi.fn(),debug:vi.fn()})}));
let app:express.Express;
let org:number;
let user:number;
const profileId=randomUUID();
const destinationId=randomUUID();
let otherTenantProfileId:string;
let otherProjectProfileId:string;
const content='Feature: BDD\n  Scenario: Hello\n    Given a greeting';
it('previews localized Rule, inherited tags and structured step arguments without saving',async()=>{
  const preview=await request(app).post('/api/tests/import-bundle').send({dryRun:true,format:'gherkin',bdd:{mode:'manual'},content:'# language: it\n@feature\nFunzionalità: Anteprima\n  Regola: Conversazione\n    @scenario\n    Scenario: Argomenti\n      Dato un messaggio\n        """text/plain\n        ciao\n        """\n      Quando una tabella\n        | valore |\n        | uno |'}).expect(200);
  expect(preview.body.results[0].gherkin).toEqual({language:'it',scenario:'Argomenti',rule:'Conversazione',tags:['@feature','@scenario'],arguments:['docString','dataTable'],mode:'manual'});
});
beforeAll(async () => {
  org=await createTestOrganization('BDD imports');user=await createTestUser(org,`bdd-import-owner-${randomUUID()}`);
  await privilegedDb.insert(agents).values({id:randomUUID(),organizationId:org,name:'BDD',pool:'bdd',tokenPrefix:'wfa_',tokenHash:randomUUID(),bddProfiles:[{id:'shop',label:'Shop',provider:'cucumber-js',revision:'rev-1',maxDurationMs:60000}]});
  await privilegedDb.insert(bddExecutionProfiles).values({id:profileId,organizationId:org,name:'Shop',pool:'bdd',operatorProfileId:'shop',revision:'rev-1'});
  await privilegedDb.insert(bddExecutionProfiles).values({id:destinationId,organizationId:org,name:'Destination',pool:'bdd',operatorProfileId:'shop',revision:'rev-1'});
  const otherOrg=await createTestOrganization('BDD unauthorized destination');
  otherTenantProfileId=randomUUID();otherProjectProfileId=randomUUID();
  const [project]=await privilegedDb.insert(projects).values({organizationId:org,userId:user,name:'Other destination project'}).returning();
  await privilegedDb.insert(bddExecutionProfiles).values([
    {id:otherTenantProfileId,organizationId:otherOrg,name:'Other tenant',pool:'bdd',operatorProfileId:'shop',revision:'rev-1'},
    {id:otherProjectProfileId,organizationId:org,projectId:project.id,name:'Other project',pool:'bdd',operatorProfileId:'shop',revision:'rev-1'},
  ]);
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

it.each([true,false])('refuses a legacy same-name import over retained BDD without changing source, sequence or versions (dryRun=$0)',async dryRun => {
  const name=`Legacy over BDD ${dryRun}`;
  const bdd={source:content,uri:'legacy.feature',language:'en',scenarioLine:2,mode:'cucumber',binding:{id:profileId,revision:'rev-1'}};
  const saved=await request(app).post('/api/tests').send({name,url:'',sequence:[],elements:[],bdd}).expect(201);
  const versionsBefore=await privilegedDb.select().from(testVersions).where(eq(testVersions.testId,saved.body.id));
  const legacy={kind:'webflowmaster/tests',version:1,tests:[{name,url:'',sequence:[{id:'legacy-step',action:{id:'manualStep',name:'Manual step'},value:'A different manual step',expected:''}]}]};
  const imported=await request(app).post('/api/tests/import-bundle').send({content:JSON.stringify(legacy),dryRun}).expect(dryRun ? 200 : 201);
  expect(imported.body.results[0]).toMatchObject({outcome:'invalid'});
  expect(imported.body.results[0].reason).toMatch(/explicitly remove BDD/i);
  const [retained]=await privilegedDb.select().from(tests).where(eq(tests.id,saved.body.id));
  expect(retained.bdd).toEqual(bdd);
  expect(retained.sequence).toEqual(saved.body.sequence);
  expect(await privilegedDb.select().from(testVersions).where(eq(testVersions.testId,saved.body.id))).toEqual(versionsBefore);
});

it('clears BDD and records the replacement sequence together on an explicit bdd:null import',async () => {
  const name='Explicit legacy conversion';
  const saved=await request(app).post('/api/tests').send({name,url:'',sequence:[],elements:[],bdd:{source:content,uri:'conversion.feature',language:'en',scenarioLine:2,mode:'cucumber',binding:{id:profileId,revision:'rev-1'}}}).expect(201);
  const sequence=[{id:'manual-conversion',action:{id:'manualStep',name:'Manual step'},value:'The converted manual instruction',expected:''}];
  const converted={kind:'webflowmaster/tests',version:1,tests:[{name,url:'',sequence,bdd:null}]};
  expect((await request(app).post('/api/tests/import-bundle').send({content:JSON.stringify(converted)}).expect(201)).body.results[0].outcome).toBe('updated');
  const [row]=await privilegedDb.select().from(tests).where(eq(tests.id,saved.body.id));
  expect(row.bdd).toBeNull();expect(row.sequence).toEqual(sequence);
  const versions=await privilegedDb.select().from(testVersions).where(eq(testVersions.testId,row.id));
  expect(versions).toHaveLength(2);
  expect(versions.find(version => version.version===2)).toMatchObject({bdd:null,sequence});
});

it.each(['json','yaml','gherkin'] as const)('requires explicit authorized destination mapping for locally resolvable portable %s Cucumber metadata',async format => {
  const source='Feature: Portable\n  Scenario Outline: Greeting\n    Given a <greeting>\n    Examples:\n      | greeting |\n      | hello |';
  const bdd={source,uri:'portable.feature',language:'en',scenarioLine:2,exampleLine:6,mode:'cucumber',binding:{id:profileId,revision:'rev-1'}};
  const saved=await request(app).post('/api/tests').send({name:`Export source ${format}`,url:'',sequence:[],elements:[],bdd}).expect(201);
  const [row]=await privilegedDb.select().from(tests).where(eq(tests.id,saved.body.id));
  const name=`Portable mapped ${format}`;
  const exported=exportBundle({project:null,tests:[{...row,name}],apiTests:[]},format);
  const importInput={content:exported.content,...(format==='gherkin' ? {format} : {})};
  for (const dryRun of [true,false]) {
    const implicit=await request(app).post('/api/tests/import-bundle').send({...importInput,dryRun}).expect(dryRun ? 200 : 201);
    expect(implicit.body.results[0].outcome).toBe('invalid');
    expect(implicit.body.results[0].reason).toMatch(/explicit.*destination.*binding/i);
  }
  expect(await privilegedDb.select().from(tests).where(eq(tests.name,name))).toEqual([]);
  for (const binding of [{id:otherTenantProfileId,revision:'rev-1'},{id:otherProjectProfileId,revision:'rev-1'},{id:destinationId,revision:'wrong'}]) {
    const invalid=await request(app).post('/api/tests/import-bundle').send({...importInput,dryRun:true,bdd:{mode:'cucumber',binding}}).expect(200);
    expect(invalid.body.results[0].outcome).toBe('invalid');
  }
  const mapped={mode:'cucumber',binding:{id:destinationId,revision:'rev-1'}};
  expect((await request(app).post('/api/tests/import-bundle').send({...importInput,dryRun:true,bdd:mapped}).expect(200)).body.results[0].outcome).toBe('created');
  expect((await request(app).post('/api/tests/import-bundle').send({...importInput,bdd:mapped}).expect(201)).body.results[0].outcome).toBe('created');
  const [imported]=await privilegedDb.select().from(tests).where(eq(tests.name,name));
  expect(imported.bdd).toEqual({...bdd,...mapped});
  expect(imported.sequence).toEqual(row.sequence);
  const [version]=await privilegedDb.select().from(testVersions).where(eq(testVersions.testId,imported.id));
  expect(version.bdd).toEqual({...bdd,...mapped});
});

it.each(['json','yaml','gherkin'] as const)('explicit manual import conversion removes the executable binding from portable %s metadata',async format => {
  const bdd={source:content,uri:'manual.feature',language:'en',scenarioLine:2,mode:'cucumber',binding:{id:profileId,revision:'rev-1'}};
  const saved=await request(app).post('/api/tests').send({name:`Manual conversion ${format}`,url:'',sequence:[],elements:[],bdd}).expect(201);
  const [row]=await privilegedDb.select().from(tests).where(eq(tests.id,saved.body.id));
  const exported=exportBundle({project:null,tests:[row],apiTests:[]},format);
  const imported=await request(app).post('/api/tests/import-bundle').send({content:exported.content,...(format==='gherkin' ? {format} : {}),bdd:{mode:'manual'}}).expect(201);
  expect(imported.body.results[0].outcome).toBe('updated');
  const [manual]=await privilegedDb.select().from(tests).where(eq(tests.id,row.id));
  const {binding:_binding,...definition}=bdd;
  expect(manual.bdd).toEqual({...definition,mode:'manual'});
  expect(manual.sequence).toEqual(row.sequence);
  const versions=await privilegedDb.select().from(testVersions).where(eq(testVersions.testId,row.id));
  expect(versions).toHaveLength(2);
  expect(versions.find(version => version.version===2)?.bdd).toEqual({...definition,mode:'manual'});
});

it.each([
  {content:'    Feature: Indented detection\n      Scenario: Greeting\n        Given a greeting',name:'Indented detection / Greeting',language:'en'},
  {content:'# language: fr\n    Fonctionnalité: Détection française\n      Scénario: Salutation\n        Soit une salutation',name:'Détection française / Salutation',language:'fr'},
])('keeps automatic feature detection for $language Gherkin with indentation',async fixture => {
  const imported=await request(app).post('/api/tests/import-bundle').send({content:fixture.content}).expect(201);
  expect(imported.body.results[0]).toMatchObject({name:fixture.name,outcome:'created'});
  const [saved]=await privilegedDb.select().from(tests).where(eq(tests.name,fixture.name));
  expect(saved.bdd).toMatchObject({source:fixture.content,language:fixture.language,mode:'manual'});
});
