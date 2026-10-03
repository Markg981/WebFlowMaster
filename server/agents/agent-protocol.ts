import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { AGENT_PATHS } from '@shared/agents';
import type { AgentProtocolRequest, AgentProtocolReply, ProtocolResponse } from '@shared/agent-protocol';
import { relayBaseUrl, RUNNER_PLAYWRIGHT_VERSION, type AgentTarget } from './agent-browser';
import { relaySecret, signTicket } from './agent-credentials';

/** Native API request, executed by the agent over its existing outbound session relay. */
export async function runProtocolOnAgent(
  agent: AgentTarget,
  request: AgentProtocolRequest,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
  waitForSlotMs = 6000,
): Promise<ProtocolResponse> {
  const ticket = signTicket({
    ...agent, engine: 'chromium', headless: true, playwrightVersion: RUNNER_PLAYWRIGHT_VERSION,
    apiProtocol: request.protocol,
  }, relaySecret(env));
  const base = relayBaseUrl(env);
  const deadline = Date.now() + waitForSlotMs;
  const availabilitySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  let available: { available: boolean; reason?: string };
  do {
    const availability = await fetch(`${base}/api/agent/v1/availability?ticket=${encodeURIComponent(ticket)}`, { signal: availabilitySignal });
    available = await availability.json() as typeof available;
    if (available.available || !available.reason?.includes('busy or draining') || Date.now() >= deadline) break;
    // Browser close is acknowledged before the agent process and cluster directory release its slot.
    await delay(100, undefined, { signal: availabilitySignal });
  } while (true);
  if (!available.available) throw new Error(available.reason ?? 'No agent supports this API protocol.');

  return new Promise<ProtocolResponse>((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/i, 'ws')}${AGENT_PATHS.browser}?ticket=${encodeURIComponent(ticket)}`, {
      handshakeTimeout: 10_000, maxPayload: 16 * 1024 * 1024,
    });
    let settled = false;
    const finish = (error?: Error, response?: ProtocolResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.terminate();
      if (error) reject(error);
      else resolve(response!);
    };
    // Includes the relay's allowance for opening the agent session.
    const timer = setTimeout(() => finish(new Error(`The ${request.protocol} request on agent pool "${agent.pool}" timed out.`)), request.timeoutMs + (request.protocol === 'websocket' ? 60_000 : 0) + 30_000);
    const onAbort = () => finish(new DOMException('The agent API request was aborted.', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.on('open', () => socket.send(JSON.stringify(request)));
    socket.on('message', (raw) => {
      try {
        const reply = JSON.parse(raw.toString()) as AgentProtocolReply;
        if ('error' in reply) finish(new Error(reply.error));
        else if (reply.response && typeof reply.response.status === 'number') finish(undefined, reply.response);
        else finish(new Error('The agent sent an invalid protocol response.'));
      } catch {
        finish(new Error('The agent sent an invalid protocol response.'));
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', (_code, reason) => finish(new Error(reason.toString() || 'The agent disconnected before returning the API response.')));
    socket.on('unexpected-response', (_req, response) => {
      response.resume();
      finish(new Error(`The agent relay refused the API session: HTTP ${response.statusCode}.`));
    });
    if (signal?.aborted) onAbort();
  });
}
