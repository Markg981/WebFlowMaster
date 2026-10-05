import type { Test, Precondition, Cleanup } from '@shared/schema';
import { BDD_MAX_OUTPUT_BYTES, BddAgentResultSchema, type BddAgentResult } from '@shared/bdd-agent';
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
  // Only evidence contains user text. World values must never replace verdicts or kinds.
  const sanitize = (value:string,vars:Record<string,string>):string => redactString(redactHistoryEntry({responseBody:value},vars).responseBody!);
  const budgetError='Combined BDD results exceed the output budget; evidence was discarded.';
  const enforceOutputBudget = () => {
    if (Buffer.byteLength(JSON.stringify({...result,bdd:{runs}})) > BDD_MAX_OUTPUT_BYTES) {
      steps.length=0;
      runs.length=0;
      throw new Error(budgetError);
    }
  };
  try {
    const bdd = validateBddTest(test.bdd);
    const profile = await withTenantTransaction(tx => resolveBddBinding(tx,bdd,test.projectId));
    if (!profile) throw new Error('Cucumber execution requires an authorized BDD profile.');
    const organizationId=getTenantOrgId();
    if (!organizationId) throw new Error('BDD execution requires an organization context.');
    const target={organizationId,pool:profile.pool};
    const rows=Array.isArray(test.dataset) && test.dataset.length ? test.dataset : [{}];
    for (const [index,row] of rows.entries()) {
      const vars={...variables,...Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([name,value]) => [name,value == null ? '' : String(value)]))};
      redactionValues=vars;
      if (options?.signal?.aborted) throw new DOMException('BDD execution was aborted.','AbortError');
      const preconditionHttp=new AgentHttp(target);
      agentHttp=preconditionHttp;
      try {
        const pre=await runPreconditions(test.preconditions as Precondition[]|null,vars,preconditionHttp.fetch as typeof fetch);
        // AgentHttp borrows a browser slot on its first request. Return it before BDD
        // selection so an agent configured with one slot can execute the scenario.
        await preconditionHttp.close();
        agentHttp=undefined;
        steps.push(...pre.steps.map(step=>({name:sanitize(step.name,vars),type:'precondition',status:step.status === 'failed' ? 'failed' as const : 'passed' as const,details:sanitize(step.detail ?? step.status,vars)})));
        enforceOutputBudget();
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
        const safe=BddAgentResultSchema.parse({...run,
          ...(run.error !== undefined && {error:sanitize(run.error,vars)}),
          steps:run.steps.map(step=>({...step,name:sanitize(step.name,vars),
            ...(step.keyword !== undefined && {keyword:sanitize(step.keyword,vars)}),
            ...(step.error !== undefined && {error:sanitize(step.error,vars)}),
          })),
          ...(run.attachments && {attachments:run.attachments.map(attachment=>({...attachment,text:sanitize(attachment.text,vars)}))}),
        });
        runs.push(safe);
        steps.push(...safe.steps.map(step => ({name:`${rows.length > 1 ? `Row ${index+1} — ` : ''}${step.keyword ? `${step.keyword} ` : ''}${step.name}`,type:step.kind === 'hook' ? 'cucumberHook' : 'cucumber',status:step.status === 'PASSED' ? 'passed' as const : 'failed' as const,details:`${step.status} (${step.durationMs}ms)`,error:step.error})));
        enforceOutputBudget();
        if (safe.status !== 'passed') {result.error=safe.error || 'Cucumber scenario did not pass.';result.status='failed';break;}
      } finally {
        await agentHttp?.close();
        const cleanupHttp=new AgentHttp(target);
        agentHttp=cleanupHttp;
        try {
          const cleanup=await runCleanups(test.cleanups as Cleanup[]|null,[vars],cleanupHttp.fetch as typeof fetch);
          steps.push(...cleanup.steps.map(step => ({name:sanitize(step.name,vars),type:'cleanup',status:step.status === 'done' || step.status === 'gone' ? 'passed' as const : 'failed' as const,details:sanitize(step.detail,vars)})));
          enforceOutputBudget();
        } finally {
          await cleanupHttp.close();
          agentHttp=undefined;
        }
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
  const safeResult={...result,name:sanitize(result.name,redactionValues),
    ...(result.error !== undefined && {error:sanitize(result.error,redactionValues)}),bdd:{runs}};
  // Errors and redaction can grow after phase checks. The final persisted object,
  // including both normalized representations and cleanup, must fit the same cap.
  if (Buffer.byteLength(JSON.stringify(safeResult)) > BDD_MAX_OUTPUT_BYTES) {
    return {...safeResult,name:safeResult.name.slice(0,1024),success:false,status:'error',error:budgetError,steps:[],bdd:{runs:[]}};
  }
  return safeResult;
}
