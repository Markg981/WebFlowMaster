import type { Test, Precondition, Cleanup } from '@shared/schema';
import { BddAgentResultSchema, type BddAgentResult } from '@shared/bdd-agent';
import { validateBddTest } from './gherkin';
import { resolveBddBinding } from './bdd-profiles';
import { getTenantOrgId, withTenantTransaction } from './middleware/tenancy';
import { runBddOnAgent } from './agents/agent-bdd';
import { AgentHttp } from './agents/agent-fetch';
import { runPreconditions } from './precondition-runner';
import { runCleanups } from './cleanup-runner';
import { redactHistoryEntry } from './history-redaction';
import { redactString } from './utils/log-redactor';
import type { IndividualTestRunResult, RunTestOptions } from './test-execution-service';

export async function runDedicatedBddTest(test:Test,variables:Record<string,string>,options?:RunTestOptions):Promise<IndividualTestRunResult> {
  const start = Date.now();
  const steps: NonNullable<IndividualTestRunResult['steps']> = [];
  const runs:BddAgentResult[] = [];
  let agentHttp:AgentHttp|undefined;
  let redactionValues={...variables};
  const result:IndividualTestRunResult = {testId:test.id,testType:'ui',name:test.name,success:false,status:'error',durationMs:0,steps};
  const sanitize = <T>(value:T,vars:Record<string,string>):T => JSON.parse(redactHistoryEntry({responseBody:JSON.stringify(value)},vars).responseBody!,(_key,item:unknown) => typeof item === 'string' ? redactString(item) : item);
  try {
    const bdd = validateBddTest(test.bdd);
    const profile = await withTenantTransaction(tx => resolveBddBinding(tx,bdd,test.projectId));
    if (!profile) throw new Error('Cucumber execution requires an authorized BDD profile.');
    const organizationId=getTenantOrgId();
    if (!organizationId) throw new Error('BDD execution requires an organization context.');
    const target={organizationId,pool:profile.pool};
    agentHttp=new AgentHttp(target);
    const transport = agentHttp.fetch as typeof fetch;
    const rows=Array.isArray(test.dataset) && test.dataset.length ? test.dataset : [{}];
    for (const [index,row] of rows.entries()) {
      const vars={...variables,...Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([name,value]) => [name,value == null ? '' : String(value)]))};
      redactionValues=vars;
      if (options?.signal?.aborted) throw new DOMException('BDD execution was aborted.','AbortError');
      try {
        const pre=await runPreconditions(test.preconditions as Precondition[]|null,vars,transport);
        steps.push(...sanitize(pre.steps,vars).map(step=>({name:step.name,type:'precondition',status:step.status === 'failed' ? 'failed' as const : 'passed' as const,details:step.detail})));
        if (!pre.ok && options?.onPreconditionFailure !== 'continue') {
          result.blockedByPrecondition=true;
          result.status=options?.onPreconditionFailure === 'skip' ? 'skipped' : 'error';
          result.error=`Precondition failed at "${pre.failedAt}": ${pre.reason}`;
          break;
        }
        const run=BddAgentResultSchema.parse(await runBddOnAgent(target,{
          source:bdd.source,uri:bdd.uri,scenarioLine:bdd.scenarioLine,exampleLine:bdd.exampleLine,
          profile:{id:profile.operatorProfileId,revision:profile.revision},variables:vars,timeoutMs:profile.timeoutMs,
        },process.env,options?.signal));
        const safe=sanitize(run,vars);
        runs.push(safe);
        steps.push(...safe.steps.map(step => ({name:`${rows.length > 1 ? `Row ${index+1} — ` : ''}${step.keyword ? `${step.keyword} ` : ''}${step.name}`,type:step.kind === 'hook' ? 'cucumberHook' : 'cucumber',status:step.status === 'PASSED' ? 'passed' as const : 'failed' as const,details:`${step.status} (${step.durationMs}ms)`,error:step.error})));
        if (Buffer.byteLength(JSON.stringify({steps,runs})) > 8*1024*1024) throw new Error('Combined BDD results exceed the output budget.');
        if (safe.status !== 'passed') {result.error=safe.error || 'Cucumber scenario did not pass.';result.status='failed';break;}
      } finally {
        const cleanup=await runCleanups(test.cleanups as Cleanup[]|null,[vars],transport);
        steps.push(...sanitize(cleanup.steps,vars).map(step => ({name:step.name,type:'cleanup',status:step.status === 'done' || step.status === 'gone' ? 'passed' as const : 'failed' as const,details:step.detail})));
      }
    }
    if (!result.error && runs.length && runs.every(run => run.status === 'passed')) {result.success=true;result.status='passed';}
  } catch(error) {
    result.error=(error as Error).message;
    result.status='error';
  } finally {
    await agentHttp?.close();
  }
  result.durationMs=Date.now()-start;
  return {...sanitize(result,redactionValues),bdd:{runs}};
}
