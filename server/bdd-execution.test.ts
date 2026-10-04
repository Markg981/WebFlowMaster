import { beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { privilegedDb } from './db';
import { agents,bddExecutionProfiles,tests,testPlans,testPlanSelectedTests,testPlanExecutions,reportTestCaseResults } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { createTestOrganization, createTestUser } from './tests/factories';
import { runWithTenant } from './middleware/tenancy';
import { runTest,processTestPlanJob } from './test-execution-service';
import * as browsers from './browsers';
import * as agentBrowser from './agents/agent-browser';
const run = vi.fn(async (..._args:unknown[]) => ({status:'passed',durationMs:1,steps:[{name:'a',kind:'step',status:'PASSED',durationMs:1}]}));
vi.mock('./agents/agent-bdd',() => ({runBddOnAgent:(...args:unknown[]) => run(...args)}));
let org:number;
let user:number;
const id=randomUUID();
beforeAll(async () => {
  org=await createTestOrganization('BDD execution');user=await createTestUser(org,`bdd-execution-owner-${randomUUID()}`);
  await privilegedDb.insert(agents).values({id:randomUUID(),organizationId:org,name:'BDD',pool:'bdd',tokenPrefix:'wfa_',tokenHash:randomUUID(),bddProfiles:[{id:'shop',label:'Shop',provider:'cucumber-js',revision:'rev-1',maxDurationMs:60000}]});
  await privilegedDb.insert(bddExecutionProfiles).values({id,organizationId:org,name:'Shop',pool:'bdd',operatorProfileId:'shop',revision:'rev-1'});
});
const source='Feature: F\nScenario: S\nGiven a';
it.each([false,true])('returns the dedicated HTTP session after BDD execution (failure=%s)',async failure => {
  const close=vi.fn(async () => {});
  const fetch=vi.fn(async () => ({status:()=>200,statusText:()=> 'OK',headersArray:()=>[],body:async()=>Buffer.from('{}')}));
  const connect=vi.spyOn(agentBrowser,'connectToAgentBrowser').mockResolvedValue({isConnected:()=>true,newContext:async()=>({request:{fetch},close:async()=>{}}),close} as any);
  try {
    if(failure) run.mockRejectedValueOnce(new Error('Fixture Cucumber failure'));
    const test={id:1,name:'BDD setup',projectId:null,preconditions:[{id:'setup',name:'setup',method:'POST',url:'http://fixture.test/setup',queryParams:null,requestHeaders:null,requestBody:null,sourceApiTestId:null}],bdd:{language:'en',source,uri:'test.feature',scenarioLine:2,mode:'cucumber',binding:{id,revision:'rev-1'}}};
    const result=await runWithTenant(org,()=>runTest(test as any,user,'plan','run','ui',{}));
    expect(result.success).toBe(!failure);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({agent:{organizationId:org,pool:'bdd'}}));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {connect.mockRestore();}
});
it('dispatches a Cucumber-bound manual-shaped sequence to its dedicated profile instead of waiting for a manual verdict',async () => {
  const test={id:1,name:'BDD',projectId:null,sequence:[{action:{id:'manualStep'},value:'Given a'}],bdd:{language:'en',source,uri:'test.feature',scenarioLine:2,mode:'cucumber',binding:{id,revision:'rev-1'}}};
  const result=await runWithTenant(org,() => runTest(test as any,user,'plan','run','ui',{}));
  expect(result.success).toBe(true);
  expect(run).toHaveBeenCalledWith({organizationId:org,pool:'bdd'},expect.objectContaining({source,profile:{id:'shop',revision:'rev-1'}}),expect.anything(),undefined);
  expect(result.steps?.[0]).toMatchObject({type:'cucumber',status:'passed'});
});
it.each([1,2])('records independent dataset results without multiplying browser or locale matrices (%s shards)',async shards => {
  run.mockClear();
  const [test]=await privilegedDb.insert(tests).values({organizationId:org,userId:user,name:'BDD dataset',url:'',elements:[],sequence:[{action:{id:'manualStep'},value:'Given a'}],dataset:[{row:'first'},{row:'second'}],bdd:{language:'en',source,uri:'test.feature',scenarioLine:2,mode:'cucumber',binding:{id,revision:'rev-1'}}}).returning();
  const planId=randomUUID(),executionId=randomUUID();
  await privilegedDb.insert(testPlans).values({id:planId,organizationId:org,userId:user,name:'BDD plan',locales:['it','en'],shards});
  await privilegedDb.insert(testPlanSelectedTests).values({organizationId:org,testPlanId:planId,testType:'ui',testId:test.id});
  await privilegedDb.insert(testPlanExecutions).values({id:executionId,organizationId:org,testPlanId:planId,status:'queued',triggeredBy:'manual',browsers:['chrome','firefox']});
  await processTestPlanJob(planId,executionId,user);
  const results=await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId,executionId));
  expect(results).toHaveLength(2);
  expect(results.every(result => result.status === 'Passed' && !result.browser)).toBe(true);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls.map(call => (call[1] as any).variables.row)).toEqual(['first','second']);
});
it('redacts credential-shaped free-text diagnostics even when the credential was created by a step',async () => {
  run.mockRejectedValueOnce(new Error('Authorization: Bearer newly-generated-secret'));
  const test={id:1,name:'BDD',projectId:null,bdd:{language:'en',source,uri:'test.feature',scenarioLine:2,mode:'cucumber',binding:{id,revision:'rev-1'}}};
  const result=await runWithTenant(org,() => runTest(test as any,user,'plan','run','ui',{}));
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('newly-generated-secret');
});
it('still executes BDD in a mixed plan when every browser fails to start',async () => {
  run.mockClear();
  const launch=vi.spyOn(browsers,'launchBrowser').mockRejectedValue(new Error('Fixture browser is unavailable'));
  const planId=randomUUID(),executionId=randomUUID();
  try {
    const [bdd]=await privilegedDb.insert(tests).values({organizationId:org,userId:user,name:'Independent BDD',url:'',elements:[],sequence:[{action:{id:'manualStep'},value:'Given a'}],bdd:{language:'en',source,uri:'test.feature',scenarioLine:2,mode:'cucumber',binding:{id,revision:'rev-1'}}}).returning();
    const [web]=await privilegedDb.insert(tests).values({organizationId:org,userId:user,name:'Browser unavailable',url:'http://fixture.invalid',elements:[],sequence:[{action:{id:'click'},value:'#x'}]}).returning();
    await privilegedDb.insert(testPlans).values({id:planId,organizationId:org,userId:user,name:'Mixed BDD plan',testMachinesConfig:[{browserName:'chromium',headless:true}]});
    await privilegedDb.insert(testPlanSelectedTests).values([{organizationId:org,testPlanId:planId,testType:'ui',testId:bdd.id},{organizationId:org,testPlanId:planId,testType:'ui',testId:web.id}]);
    await privilegedDb.insert(testPlanExecutions).values({id:executionId,organizationId:org,testPlanId:planId,status:'queued',triggeredBy:'manual'});
    await processTestPlanJob(planId,executionId,user);
    const results=await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId,executionId));
    expect(results.find(result => result.uiTestId === bdd.id)).toMatchObject({status:'Passed',browser:null});
    expect(run).toHaveBeenCalledTimes(1);
  } finally {launch.mockRestore();}
});
