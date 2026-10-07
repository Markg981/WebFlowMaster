import { SpanKind } from '@opentelemetry/api';
import { withSpan } from '../../shared/telemetry';
import WebSocket from 'ws';
import { setTimeout as delay } from 'timers/promises';
import { AGENT_PATHS } from '@shared/agents';
import { BddAgentRequestSchema, BddAgentResultSchema, type BddAgentRequest, type BddAgentResult } from '@shared/bdd-agent';
import { signTicket, relaySecret } from './agent-credentials';
import { relayBaseUrl, RUNNER_PLAYWRIGHT_VERSION } from './agent-browser';

class BddCapacityRefusal extends Error {}

async function runBddOnAgentImpl(agent: {organizationId:number;pool:string}, input: BddAgentRequest, env:NodeJS.ProcessEnv = process.env, signal?:AbortSignal):Promise<BddAgentResult> {
  const request = BddAgentRequestSchema.parse(input);
  const payload = JSON.stringify(request);
  if (Buffer.byteLength(payload) > 64 * 1024 * 1024) throw new Error('Serialized BDD request exceeds the relay limit.');
  const ticket = signTicket({...agent,engine:'chromium',headless:true,playwrightVersion:RUNNER_PLAYWRIGHT_VERSION,bddProfile:request.profile},relaySecret(env));
  const base = relayBaseUrl(env);
  const availabilitySignal = signal ? AbortSignal.any([signal,AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const slotDeadline = Date.now() + 6000;
  while (true) {
    const response = await fetch(`${base}/api/agent/v1/availability?ticket=${encodeURIComponent(ticket)}`,{signal:availabilitySignal});
    if (!response.ok) throw new Error(`BDD relay availability failed: HTTP ${response.status}`);
    const available = await response.json() as {available:boolean;reason?:string};
    if (!available.available) {
      if (!available.reason?.includes('busy or draining') || Date.now() >= slotDeadline) throw new Error(available.reason || 'No dedicated BDD agent is available.');
    } else {
      try {
        return await openBddSession(base, ticket, payload, request.timeoutMs, signal);
      } catch (error) {
        // Availability and the agent's socket teardown can race. Only retry a
        // relay refusal before dispatch: replaying an executed scenario is unsafe.
        if (!(error instanceof BddCapacityRefusal) || Date.now() >= slotDeadline) throw error;
      }
    }
    await delay(100,undefined,{signal:availabilitySignal});
  }
}

function openBddSession(base:string, ticket:string, payload:string, timeoutMs:number, signal?:AbortSignal):Promise<BddAgentResult> {
  return new Promise((resolve,reject) => {
    const socket = new WebSocket(`${base.replace(/^http/i,'ws')}${AGENT_PATHS.browser}?ticket=${encodeURIComponent(ticket)}`,{handshakeTimeout:10_000,maxPayload:8*1024*1024});
    let settled = false;
    const finish = (error?:Error,result?:BddAgentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      socket.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException('BDD execution was aborted.','AbortError'));
    const timer = setTimeout(() => finish(new Error('Dedicated BDD execution timed out.')),timeoutMs+30_000);
    signal?.addEventListener('abort',abort,{once:true});
    socket.once('open',() => socket.send(payload));
    socket.once('message',raw => {
      try {
        const reply = JSON.parse(raw.toString());
        if (typeof reply.error === 'string') finish(new Error(reply.error));
        else finish(undefined,BddAgentResultSchema.parse(reply.result));
      } catch { finish(new Error('The dedicated agent returned invalid or incomplete BDD results.')); }
    });
    socket.once('error',error => finish(error));
    socket.once('close',(code,reason) => {
      const detail = reason.toString();
      const refused = code === 1011 && detail.startsWith('The agent could not start the browser: ');
      if (refused && detail === 'The agent could not start the browser: The agent is at capacity.') finish(new BddCapacityRefusal(detail));
      else finish(new Error(refused ? detail : 'The dedicated agent disconnected before returning BDD results.'));
    });
    socket.once('unexpected-response',(_req,response) => { response.resume();finish(new Error(`The relay refused the BDD session: HTTP ${response.statusCode}`)); });
    if (signal?.aborted) abort();
  });
}

export function runBddOnAgent(...args: Parameters<typeof runBddOnAgentImpl>): ReturnType<typeof runBddOnAgentImpl> {
  return withSpan('agent.runBddOnAgent', SpanKind.CLIENT, undefined, () => runBddOnAgentImpl(...args));
}
